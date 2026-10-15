import { relative, resolve as absolute } from 'node:path';
import type { API as NativeAPI, Type, Symbol as CompilerSymbol, Snapshot } from 'typescript/unstable/async';
import type { Node } from 'typescript/unstable/ast';
import { reject, type Diagnostic, type Location, type Result } from './diagnostics.ts';
import type { Place, Reference, ElementUse } from './model.ts';
import type { SourceSet } from './workspace-model.ts';
export type TypeHandle = { readonly kind: 'Type'; readonly id: number; readonly at?: Location };
export type SemanticDeclaration = {
  readonly id: string;
  readonly name: string;
  readonly form: 'Alias' | 'Interface';
  readonly at: Location;
  readonly place: Place;
  readonly exported: boolean;
  readonly generic: boolean;
  readonly type: TypeHandle;
  readonly references: readonly Reference[];
  readonly application?: { readonly definition: string; readonly arguments: readonly TypeHandle[] };
};
export type SemanticMember = { readonly name: string; readonly type: TypeHandle; readonly at: Location };
export type TypeClass =
  | { readonly kind: 'StringLiteral'; readonly value: string }
  | { readonly kind: 'Scalar' }
  | { readonly kind: 'Parameter'; readonly name: string; readonly constraint: TypeHandle | undefined }
  | { readonly kind: 'Other' };
export type CompilerView = {
  readonly declarations: readonly SemanticDeclaration[];
  readonly property: (type: TypeHandle, name: string) => Promise<TypeHandle | undefined>;
  readonly members: (type: TypeHandle) => Promise<readonly SemanticMember[]>;
  readonly tuple: (type: TypeHandle) => Promise<Result<readonly TypeHandle[]>>;
  readonly classify: (type: TypeHandle) => Promise<TypeClass>;
  readonly canonical: (type: TypeHandle) => Promise<string | undefined>;
  readonly arguments: (type: TypeHandle) => Promise<readonly TypeHandle[]>;
  readonly familyLambda: (type: TypeHandle) => Promise<TypeHandle>;
  readonly references: (type: TypeHandle) => Promise<readonly ElementUse[]>;
  readonly display: (type: TypeHandle) => Promise<string>;
  readonly isDescriptor: (type: TypeHandle) => Promise<boolean>;
};
const invalidSemantic = Symbol('invalid-semantic');
type InvalidSemantic = { readonly [invalidSemantic]: Diagnostic };
function isInvalidSemantic(value: unknown): value is InvalidSemantic {
  return typeof value === 'object' && value !== null && invalidSemantic in value;
}
function children(node: Node): Node[] {
  const result: Node[] = [];
  node.forEachChild((n) => {
    result.push(n);
  });
  return result;
}
function descendants(node: Node): Node[] {
  const result: Node[] = [];
  const visit = (n: Node): void => {
    result.push(n);
    for (const child of children(n)) visit(child);
  };
  visit(node);
  return result;
}
function place(path: string): Place {
  const parts = path.split('/');
  const layer = parts[0];
  if (layer !== 'architecture' && layer !== 'business' && layer !== 'relations')
    throw new Error(`Unexpected design layer: ${path}`);
  return { layer, module: parts.slice(1, -1) };
}
/** Native values and numeric handles live only inside this call. No source is executed. */
export async function withCompiler<T>(
  source: SourceSet,
  consume: (view: CompilerView) => Promise<Result<T>>,
): Promise<Result<T>> {
  let api: NativeAPI | undefined;
  let snapshot: Snapshot | undefined;
  const configAt: Location = { path: 'tsconfig.json', line: 1, column: 1 };
  try {
    // The unstable native entry may not exist in an installed environment; load it
    // inside this Result boundary so absence is CompilerUnavailable, never fallback.
    const { API, DiagnosticCategory, SymbolFlags, TypeFlags } = await import('typescript/unstable/async');
    const {
      isTypeAliasDeclaration,
      isTypeReferenceNode,
      isTypeNode,
      isTupleTypeNode,
      isInterfaceDeclaration,
      isIdentifier,
      isComputedPropertyName,
      isPropertySignatureDeclaration,
      isVariableDeclaration,
      SyntaxKind,
    } = await import('typescript/unstable/ast');
    api = new API({ cwd: source.root });
    snapshot = await api.updateSnapshot({ openProjects: [...source.projects] });
    const project = snapshot.getProject(absolute(source.root, 'tsconfig.json'));
    if (!project)
      return reject([
        {
          stage: 'typescript',
          code: 'CompilerUnavailable',
          at: configAt,
          related: [],
          message: 'Native API did not load the analysis project',
        },
      ]);
    const atNode = (node: Node): Location => {
      const file = node.getSourceFile();
      const pos = file.getLineAndCharacterOfPosition(node.getStart(file));
      return {
        path: relative(source.root, file.fileName).replaceAll('\\', '/'),
        line: pos.line + 1,
        column: pos.character + 1,
      };
    };
    const errors: Diagnostic[] = [];
    const seen = new Set<string>();
    for (const config of source.projects) {
      const p = snapshot.getProject(config);
      if (!p)
        return reject([
          {
            stage: 'typescript',
            code: 'CompilerUnavailable',
            at: { ...configAt, path: relative(source.root, config) },
            related: [],
            message: 'Native API did not load a required project',
          },
        ]);
      for (const method of [
        'getConfigFileParsingDiagnostics',
        'getProgramDiagnostics',
        'getGlobalDiagnostics',
        'getSyntacticDiagnostics',
        'getBindDiagnostics',
        'getSemanticDiagnostics',
        'getDeclarationDiagnostics',
      ] as const) {
        for (const d of await p.program[method]()) {
          if (d.category !== DiagnosticCategory.Error) continue;
          const file = d.fileName ? await p.program.getSourceFile(d.fileName) : undefined;
          const position = file?.getLineAndCharacterOfPosition(d.pos ?? 0);
          const at = {
            path: relative(source.root, d.fileName ?? config).replaceAll('\\', '/'),
            line: (position?.line ?? 0) + 1,
            column: (position?.character ?? 0) + 1,
          };
          const key = JSON.stringify([d.code, at, d.text]);
          if (seen.has(key)) continue;
          seen.add(key);
          errors.push({
            stage: 'typescript',
            code: 'CompilerDiagnostic',
            at,
            related: [],
            message: d.text,
            details: { kind: 'Compiler', code: d.code, text: d.text },
          });
        }
      }
    }
    if (errors.length) return reject(errors);
    const checker = project.checker;
    const types = new Map<number, Type>();
    const origins = new WeakMap<TypeHandle, Node>();
    const occurrences = new Map<number, Node[]>();
    const handle = (type: Type, origin?: Node): TypeHandle => {
      types.set(type.id, type);
      const h: TypeHandle = { kind: 'Type', id: type.id, ...(origin ? { at: atNode(origin) } : {}) };
      if (origin) origins.set(h, origin);
      return h;
    };
    const native = (type: TypeHandle): Type => {
      const value = types.get(type.id);
      if (!value) throw new Error('Unknown session type handle');
      return value;
    };
    const symbolIds = new Map<number, string>();
    const entries: {
      node: Node;
      symbol: CompilerSymbol;
      declaration: Omit<SemanticDeclaration, 'references'>;
    }[] = [];
    const normalized = async (symbol: CompilerSymbol): Promise<CompilerSymbol | undefined> => {
      const target = symbol.flags & SymbolFlags.Alias ? await checker.getAliasedSymbol(symbol) : symbol;
      return (await checker.isUnknownSymbol(target)) ? undefined : target;
    };
    for (const path of source.types) {
      const file = await project.program.getSourceFile(path);
      if (!file)
        return reject([
          {
            stage: 'resolve',
            code: 'UnresolvedReference',
            at: { path: relative(source.root, path), line: 1, column: 1 },
            related: [],
            message: 'Design source absent from analysis project',
          },
        ]);
      for (const node of file.statements) {
        if (!isTypeAliasDeclaration(node) && !isInterfaceDeclaration(node)) continue;
        const symbol = await checker.getSymbolAtLocation(node.name);
        if (!symbol) continue;
        const at = atNode(node.name);
        const id = `${at.path}#${symbol.name}`;
        symbolIds.set(symbol.id, id);
        const type = await checker.getDeclaredTypeOfSymbol(symbol);
        entries.push({
          node,
          symbol,
          declaration: {
            id,
            name: symbol.name,
            form: isTypeAliasDeclaration(node) ? 'Alias' : 'Interface',
            at,
            place: place(at.path),
            exported: node.modifiers?.some((m) => m.kind === SyntaxKind.ExportKeyword) ?? false,
            generic: Boolean(node.typeParameters?.length),
            type: handle(type, isTypeAliasDeclaration(node) ? node.type : node),
          },
        });
      }
    }
    const declarations: SemanticDeclaration[] = [];
    for (const entry of entries) {
      const typeNodes = descendants(entry.node).filter(isTypeNode);
      const resolvedTypes = await checker.getTypeAtLocation(typeNodes);
      typeNodes.forEach((node, index) => {
        const type = resolvedTypes[index];
        if (type) {
          const locations = occurrences.get(type.id) ?? [];
          locations.push(node);
          occurrences.set(type.id, locations);
        }
      });
      const references: Reference[] = [];
      const visited = new Set<string>();
      for (const node of descendants(entry.node)) {
        if (!isIdentifier(node)) continue;
        const symbol = await checker.getSymbolAtLocation(node);
        if (!symbol) continue;
        const target = await normalized(symbol);
        if (!target) continue;
        const to = symbolIds.get(target.id);
        if (!to) continue;
        const at = atNode(node);
        const key = JSON.stringify([to, at]);
        if (visited.has(key)) continue;
        visited.add(key);
        // The declaration name is not a semantic use; self-references elsewhere are.
        if (
          node ===
          (isTypeAliasDeclaration(entry.node) || isInterfaceDeclaration(entry.node)
            ? entry.node.name
            : undefined)
        )
          continue;
        references.push({ from: entry.declaration.id, to, at });
      }
      let application: SemanticDeclaration['application'];
      if (
        isTypeAliasDeclaration(entry.node) &&
        isTypeReferenceNode(entry.node.type) &&
        entry.node.type.typeArguments?.length
      ) {
        const symbol = await checker.getSymbolAtLocation(entry.node.type.typeName);
        const target = symbol ? await normalized(symbol) : undefined;
        const definition = target ? symbolIds.get(target.id) : undefined;
        if (definition) {
          const arguments_: TypeHandle[] = [];
          for (const argument of entry.node.type.typeArguments) {
            const t = await checker.getTypeFromTypeNode(argument);
            if (t) arguments_.push(handle(t, argument));
          }
          application = { definition, arguments: arguments_ };
        }
      }
      declarations.push({ ...entry.declaration, references, ...(application ? { application } : {}) });
    }
    const dslPath = absolute(source.root, 'dsl/dsl.ts');
    const dsl = await project.program.getSourceFile(dslPath);
    let marker: CompilerSymbol | undefined;
    let familyArgument: CompilerSymbol | undefined;
    if (dsl)
      for (const node of descendants(dsl))
        if (isVariableDeclaration(node) && isIdentifier(node.name)) {
          if (node.name.text === 'descriptor') marker = await checker.getSymbolAtLocation(node.name);
          if (node.name.text === 'familyArgument') familyArgument = await checker.getSymbolAtLocation(node.name);
        }
    if (!marker)
      return reject([
        {
          stage: 'resolve',
          code: 'InvalidDescriptor',
          at: { path: 'dsl/dsl.ts', line: 1, column: 1 },
          related: [],
          message: 'DSL descriptor marker declaration missing',
        },
      ]);
    const markerProperty = async (property: CompilerSymbol, expected: CompilerSymbol = marker): Promise<boolean> => {
      for (const declaration of property.declarations) {
        const node = await declaration.resolve(project);
        if (!node || !isPropertySignatureDeclaration(node) || !isComputedPropertyName(node.name)) continue;
        const symbol = await checker.getSymbolAtLocation(node.name.expression);
        if (symbol?.id === expected.id) return true;
      }
      return false;
    };
    const fallback = configAt;
    const memberLocation = async (symbol: CompilerSymbol): Promise<Location> => {
      const node = await symbol.declarations[0]?.resolve(project);
      return node ? atNode(node) : fallback;
    };
    const propertyHandle = async (h: TypeHandle, symbol: CompilerSymbol): Promise<TypeHandle | undefined> => {
      const type = await checker.getTypeOfSymbol(symbol);
      if (!type) return undefined;
      const context = origins.get(h);
      const declaration = await symbol.declarations[0]?.resolve(project);
      let origin: Node | undefined;
      if (declaration && isPropertySignatureDeclaration(declaration)) {
        if (atNode(declaration).path !== 'dsl/dsl.ts') origin = declaration.type;
        else if (
          declaration.type &&
          isTypeReferenceNode(declaration.type) &&
          context &&
          isTypeReferenceNode(context)
        ) {
          const parameter = await checker.getSymbolAtLocation(declaration.type.typeName);
          let owner: Node | undefined = declaration.parent;
          while (owner && !isTypeAliasDeclaration(owner) && owner.kind !== SyntaxKind.SourceFile)
            owner = owner.parent;
          if (owner && isTypeAliasDeclaration(owner)) {
            const definition = await checker.getSymbolAtLocation(owner.name);
            const sourceSymbol = await checker.getSymbolAtLocation(context.typeName);
            const sourceDefinition = sourceSymbol ? await normalized(sourceSymbol) : undefined;
            if (definition?.id === sourceDefinition?.id)
              for (let i = 0; i < (owner.typeParameters?.length ?? 0); i++) {
                const candidate = await checker.getSymbolAtLocation(owner.typeParameters![i]!.name);
                if (candidate?.id === parameter?.id) {
                  origin = context.typeArguments?.[i];
                  break;
                }
              }
          }
        }
      }
      if (!origin && context)
        origin = (occurrences.get(type.id) ?? []).find(
          (node) =>
            node.getSourceFile() === context.getSourceFile() &&
            node.pos >= context.pos &&
            node.end <= context.end,
        );
      return handle(type, origin ?? context);
    };
    const members = async (h: TypeHandle): Promise<readonly SemanticMember[]> => {
      const result: SemanticMember[] = [];
      const record = native(h);
      if (
        record.isErrorType() ||
        record.flags & (TypeFlags.Any | TypeFlags.Never | TypeFlags.Unknown) ||
        (await checker.getIndexInfosOfType(record)).length
      )
        throw {
          [invalidSemantic]: {
            stage: 'resolve',
            code: 'InvalidDescriptor',
            at: h.at ?? fallback,
            related: [],
            message: 'Expected a finite, concrete member record',
          },
        } satisfies InvalidSemantic;
      for (const symbol of await checker.getPropertiesOfType(native(h))) {
        if (await markerProperty(symbol)) continue;
        if (symbol.flags & SymbolFlags.Optional)
          throw {
            [invalidSemantic]: {
              stage: 'resolve',
              code: 'InvalidDescriptor',
              at: await memberLocation(symbol),
              related: [],
              message: 'Optional design members require an explicit Choice',
            },
          } satisfies InvalidSemantic;
        const t = await propertyHandle(h, symbol);
        if (t) result.push({ name: symbol.name, type: t, at: t.at ?? (await memberLocation(symbol)) });
      }
      return result;
    };
    const isDescriptor = async (h: TypeHandle): Promise<boolean> => {
      const t = native(h);
      if (t.isErrorType() || t.flags & (TypeFlags.Any | TypeFlags.Never | TypeFlags.Unknown)) return false;
      for (const property of await checker.getPropertiesOfType(t))
        if (await markerProperty(property)) return true;
      return false;
    };
    const scalar = async (t: Type): Promise<boolean> => {
      if (t.isErrorType() || t.flags & (TypeFlags.Any | TypeFlags.Never | TypeFlags.Unknown)) return false;
      if (t.isUnionType()) {
        for (const part of (await t.getTypes()) ?? []) if (!(await scalar(part))) return false;
        return true;
      }
      if (t.isIntersectionType()) {
        for (const part of (await t.getTypes()) ?? []) if (await scalar(part)) return true;
        return false;
      }
      return Boolean(
        t.flags &
        (TypeFlags.StringLike |
          TypeFlags.NumberLike |
          TypeFlags.BooleanLike |
          TypeFlags.BigIntLike |
          TypeFlags.ESSymbolLike |
          TypeFlags.Null |
          TypeFlags.Undefined |
          TypeFlags.Void),
      );
    };
    return await consume({
      declarations,
      members,
      property: async (h, name) => {
        const symbol = await checker.getPropertyOfType(native(h), name);
        return symbol ? propertyHandle(h, symbol) : undefined;
      },
      tuple: async (h) => {
        const t = native(h);
        if (!(await checker.isTupleType(t)) || !t.isTypeReference())
          return reject([
            {
              stage: 'resolve',
              code: 'InvalidDescriptor',
              at: h.at ?? fallback,
              related: [],
              message: 'A finite tuple is required, not an array',
            },
          ]);
        const lengthSymbol = await checker.getPropertyOfType(t, 'length');
        const length = lengthSymbol ? await checker.getTypeOfSymbol(lengthSymbol) : undefined;
        const arguments_ = await checker.getTypeArguments(t);
        if (
          !length?.isNumberLiteralType() ||
          !Number.isInteger(length.value) ||
          length.value !== arguments_.length
        )
          return reject([
            {
              stage: 'resolve',
              code: 'InvalidDescriptor',
              at: h.at ?? fallback,
              related: [],
              message: 'Topology tuples cannot contain optional or variadic entries',
            },
          ]);
        const context = origins.get(h);
        const tupleNode =
          context && isTupleTypeNode(context) ? context : (occurrences.get(t.id) ?? []).find(isTupleTypeNode);
        return {
          kind: 'Accepted',
          value: arguments_.map((argument, index) => handle(argument, tupleNode?.elements[index] ?? context)),
        };
      },
      classify: async (h) => {
        const t = native(h);
        if (t.isTypeParameter()) {
          const s = await t.getSymbol();
          const constraint = await checker.getConstraintOfTypeParameter(t);
          return {
            kind: 'Parameter',
            name: s?.name ?? 'T',
            constraint: constraint ? handle(constraint) : undefined,
          };
        }
        if (t.isStringLiteralType()) return { kind: 'StringLiteral', value: t.value };
        return { kind: !(await isDescriptor(h)) && (await scalar(t)) ? 'Scalar' : 'Other' };
      },
      canonical: async (h) => {
        const t = native(h);
        const symbol = await t.getAliasSymbol();
        const alias = symbol ? symbolIds.get(symbol.id) : undefined;
        if (alias) return alias;
        const direct = await t.getSymbol();
        return direct ? symbolIds.get(direct.id) : undefined;
      },
      familyLambda: async (h) => {
        if (familyArgument) for (const property of await checker.getPropertiesOfType(native(h))) {
          if (!await markerProperty(property, familyArgument)) continue;
          const argument = await propertyHandle(h, property);
          if (argument) return argument;
        }
        throw { [invalidSemantic]: { stage: 'resolve', code: 'InvalidDescriptor', at: h.at ?? fallback, related: [], message: 'Family is missing its native HKT argument metadata' } } satisfies InvalidSemantic;
      },
      references: async h => {
        const result = new Map<string, ElementUse>(); const visited = new Set<number>();
        const visit = async (type: Type): Promise<void> => {
          if (visited.has(type.id)) return; visited.add(type.id);
          const alias = await type.getAliasSymbol(); const direct = await type.getSymbol();
          const id = (alias ? symbolIds.get(alias.id) : undefined) ?? (direct ? symbolIds.get(direct.id) : undefined);
          if (id) result.set(id, {target:id,at:h.at ?? fallback});
          const arguments_ = await type.getAliasTypeArguments();
          if (arguments_.length) for (const argument of arguments_) await visit(argument);
          else if (type.isTypeReference()) {
            const target = await type.getTarget(); const parameters = target.isClassOrInterface() ? await target.getLocalTypeParameters() : [];
            for (const argument of (await checker.getTypeArguments(type)).slice(0,parameters.length)) await visit(argument);
          }
          if (!id && (type.isIntersectionType() || type.isUnionType())) for (const part of await type.getTypes() ?? []) await visit(part);
        };
        await visit(native(h)); return [...result.values()];
      },
      arguments: async (h) => {
        const t = native(h);
        const alias = await t.getAliasTypeArguments();
        if (alias.length) return alias.map((argument) => handle(argument, origins.get(h)));
        if (t.isTypeReference()) {
          const target = await t.getTarget();
          const parameters = target.isClassOrInterface() ? await target.getLocalTypeParameters() : [];
          return (await checker.getTypeArguments(t))
            .slice(0, parameters.length)
            .map((argument) => handle(argument, origins.get(h)));
        }
        return [];
      },
      display: (h) => checker.typeToString(native(h)),
      isDescriptor,
    });
  } catch (error) {
    if (isInvalidSemantic(error)) return reject([error[invalidSemantic]]);
    return reject([
      {
        stage: 'typescript',
        code: 'CompilerUnavailable',
        at: configAt,
        related: [],
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  } finally {
    try {
      if (snapshot) await snapshot.dispose();
    } finally {
      if (api) await api.close();
    }
  }
}
