import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { parse as Parse, ParseResult } from '@babel/parser';
import type { File, Node, TSType, TSTypeAliasDeclaration, TSTypeReference } from '@babel/types';
import type {
  Anchor, ConnectionSpec, Continuation, DesignGraph, DesignNode, ExtractProblem,
  Layer, LifecycleSpec, Location, ModuleSpec, NodeKind, OpSpec, OpTarget,
  OutcomeSpec, Reference, ScenarioSpec, ScopeSpec, StepSpec, UnitSpec,
} from './graph-model.ts';

const nodeKinds: Record<string, true> = {
  Value: true, Opaque: true, Struct: true, Outcome: true, Point: true, Face: true,
  External: true, Lifecycle: true, Module: true, Unit: true, Scope: true, Scenario: true,
};

type Binding = { readonly file: string; readonly imported: string };
type Source = {
  readonly file: string;
  readonly layer: Layer;
  readonly place: readonly string[];
  readonly imports: Map<string, Binding>;
  readonly aliases: Map<string, TSTypeAliasDeclaration>;
};
type Element = {
  readonly source: Source;
  readonly alias: TSTypeAliasDeclaration;
  readonly expression: TSTypeReference;
  readonly node: DesignNode;
};
type Member = { readonly name: string; readonly value: TSType; readonly at: Node };

function assertNever(value: never): never {
  throw new Error(`未处理的设计元素：${String(value)}`);
}

function isNodeKind(name: string): name is NodeKind {
  return Object.hasOwn(nodeKinds, name);
}

function isAstNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isAstNode(child)) walk(child, visit);
    } else if (isAstNode(value)) {
      walk(value, visit);
    }
  }
}

function argumentsOf(node: TSTypeReference): readonly TSType[] {
  return node.typeArguments?.params ?? [];
}

function stringOf(node: TSType | undefined): string | undefined {
  return node?.type === 'TSLiteralType' && node.literal.type === 'StringLiteral' ? node.literal.value : undefined;
}

function tupleOf(node: TSType | undefined): readonly TSType[] | undefined {
  if (node?.type === 'TSTypeOperator' && node.operator === 'readonly') return tupleOf(node.typeAnnotation);
  return node?.type === 'TSTupleType' ? node.elementTypes : undefined;
}

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** 从设计目录同步抽取 DSL 节点、具名关系和无法读取的写法；不依赖 tsconfig。 */
export function extractGraph(design: string, parse: typeof Parse): DesignGraph {
  const root = realpathSync(design);
  const dsl = join(root, 'dsl', 'dsl.ts');
  const dslFile = existsSync(dsl) ? realpathSync(dsl) : dsl;
  const nodes: DesignNode[] = [];
  const connections: ConnectionSpec[] = [];
  const outcomes: OutcomeSpec[] = [];
  const modules: ModuleSpec[] = [];
  const units: UnitSpec[] = [];
  const scopes: ScopeSpec[] = [];
  const lifecycles: LifecycleSpec[] = [];
  const scenarios: ScenarioSpec[] = [];
  const continuations: Continuation[] = [];
  const references: Reference[] = [];
  const problems: ExtractProblem[] = [];
  const sources = new Map<string, Source>();
  const elements: Element[] = [];
  const byAlias = new Map<TSTypeAliasDeclaration, Element>();

  function location(source: Source, node?: Node | null): Location {
    return { file: relative(root, source.file).split(sep).join('/'), line: node?.loc?.start.line ?? 1 };
  }

  function problem(source: Source, node: Node | undefined, message: string): void {
    problems.push({ at: location(source, node), message });
  }

  function importedFile(source: Source, node: Node, path: string): string | undefined {
    if ((!path.startsWith('./') && !path.startsWith('../')) || !path.endsWith('.ts')) {
      problem(source, node, `导入或再导出路径「${path}」必须是带 .ts 后缀的相对路径`);
      return undefined;
    }
    const target = resolve(dirname(source.file), path);
    if (!inside(root, target)) {
      problem(source, node, `导入或再导出路径「${path}」必须位于 design 目录内`);
      return undefined;
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      problem(source, node, `导入或再导出路径「${path}」没有对应的文件`);
      return undefined;
    }
    const canonical = realpathSync(target);
    if (!inside(root, canonical)) {
      problem(source, node, `导入或再导出路径「${path}」解析后必须位于 design 目录内`);
      return undefined;
    }
    return canonical;
  }

  function readDirectory(directory: string, layer: Layer): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        readDirectory(file, layer);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const segments = relative(join(root, layer), dirname(file)).split(sep).filter(Boolean);
      const source: Source = {
        file, layer, place: layer === 'architecture' ? segments : segments.slice(0, 1),
        imports: new Map(), aliases: new Map(),
      };
      sources.set(realpathSync(file), source);
      let ast: ParseResult<File>;
      try {
        ast = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript'] });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const line = typeof error === 'object' && error !== null && 'loc' in error
          && typeof error.loc === 'object' && error.loc !== null && 'line' in error.loc
          && typeof error.loc.line === 'number' ? error.loc.line : 1;
        problems.push({ at: { ...location(source), line }, message: `无法解析 TypeScript：${message}` });
        continue;
      }
      for (const statement of ast.program.body) {
        if (statement.type === 'ImportDeclaration') {
          const typeOnly = statement.importKind === 'type' || (statement.specifiers.length > 0
            && statement.specifiers.every(specifier => specifier.type === 'ImportSpecifier' && specifier.importKind === 'type'));
          if (!typeOnly) problem(source, statement, '设计文件只能使用 import type 或全部为 type 的导入成员');
          const target = importedFile(source, statement, statement.source.value);
          if (target !== undefined) {
            for (const specifier of statement.specifiers) {
              switch (specifier.type) {
                case 'ImportSpecifier':
                  source.imports.set(specifier.local.name, {
                    file: target,
                    imported: specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value,
                  });
                  break;
                case 'ImportNamespaceSpecifier':
                  source.imports.set(specifier.local.name, { file: target, imported: '*' });
                  break;
                case 'ImportDefaultSpecifier':
                  source.imports.set(specifier.local.name, { file: target, imported: 'default' });
                  break;
                default: assertNever(specifier);
              }
            }
          }
        } else if (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') {
          if (statement.source !== null && statement.source !== undefined) {
            const typeOnly = statement.exportKind === 'type' || (statement.type === 'ExportNamedDeclaration'
              && statement.specifiers.length > 0 && statement.specifiers.every(specifier => specifier.type === 'ExportSpecifier' && specifier.exportKind === 'type'));
            if (!typeOnly) problem(source, statement, '设计文件只能使用 export type 或全部为 type 的再导出成员');
            importedFile(source, statement, statement.source.value);
          }
          if (statement.type === 'ExportNamedDeclaration' && statement.declaration?.type === 'TSTypeAliasDeclaration') {
            source.aliases.set(statement.declaration.id.name, statement.declaration);
          }
        }
      }
      walk(ast.program, node => {
        if (node.type === 'TSImportType') problem(source, node, '设计文件不能使用 import("…") 类型；请使用 import type');
        if (node.type === 'ImportExpression' || (node.type === 'CallExpression' && node.callee.type === 'Import')) {
          problem(source, node, '设计文件不能使用动态 import');
        }
        if (node.type === 'TSImportEqualsDeclaration') problem(source, node, '设计文件不能使用 import =；请使用相对路径的 import type');
      });
    }
  }

  function bindingOf(source: Source, reference: TSTypeReference): Binding | undefined {
    const name = reference.typeName;
    if (name.type === 'Identifier') return source.imports.get(name.name);
    if (name.type === 'TSQualifiedName' && name.left.type === 'Identifier') {
      const namespace = source.imports.get(name.left.name);
      if (namespace?.imported === '*') return { file: namespace.file, imported: name.right.name };
    }
    return undefined;
  }

  function constructorOf(source: Source, node: TSType | undefined): string | undefined {
    if (node?.type !== 'TSTypeReference') return undefined;
    const binding = bindingOf(source, node);
    return binding?.file === dslFile ? binding.imported : undefined;
  }

  function elementOf(source: Source, node: TSType | undefined): Element | undefined {
    if (node?.type !== 'TSTypeReference' || argumentsOf(node).length > 0) return undefined;
    if (node.typeName.type === 'Identifier') {
      const local = source.aliases.get(node.typeName.name);
      if (local !== undefined) return byAlias.get(local);
    }
    const binding = bindingOf(source, node);
    const alias = binding === undefined ? undefined : sources.get(binding.file)?.aliases.get(binding.imported);
    return alias === undefined ? undefined : byAlias.get(alias);
  }

  function literal(source: Source, node: TSType | undefined, at: Node, label: string): string | undefined {
    const value = stringOf(node);
    if (value === undefined) problem(source, node ?? at, `${label}必须是字符串字面量`);
    return value;
  }

  function members(source: Source, node: TSType | undefined, at: Node, label: string): readonly Member[] {
    if (node?.type !== 'TSTypeLiteral') {
      problem(source, node ?? at, `${label}必须直接写成对象类型`);
      return [];
    }
    const result: Member[] = [];
    for (const member of node.members) {
      if (member.type !== 'TSPropertySignature' || member.computed || member.typeAnnotation === undefined || member.typeAnnotation === null
        || (member.key.type !== 'Identifier' && member.key.type !== 'StringLiteral' && member.key.type !== 'NumericLiteral')) {
        problem(source, member, `${label}的成员必须是具名的类型属性`);
        continue;
      }
      result.push({ name: member.key.type === 'Identifier' ? member.key.name : String(member.key.value), value: member.typeAnnotation.typeAnnotation, at: member });
    }
    return result;
  }

  function tuple(source: Source, node: TSType | undefined, at: Node, label: string): readonly TSType[] {
    const values = tupleOf(node);
    if (values === undefined) {
      problem(source, node ?? at, `${label}必须直接写成元组`);
      return [];
    }
    return values;
  }

  function named(source: Source, node: TSType | undefined, at: Node, label: string): Element | undefined {
    const element = elementOf(source, node);
    if (element === undefined) {
      const name = node?.type === 'TSTypeReference' && node.typeName.type === 'Identifier' ? `「${node.typeName.name}」` : '';
      problem(source, node ?? at, `${label}必须引用具名 DSL 节点${name}，不能使用辅助类型或内联类型`);
    }
    return element;
  }

  function names(source: Source, node: TSType | undefined, at: Node, label: string): readonly string[] {
    return tuple(source, node, at, label).flatMap(item => {
      const element = named(source, item, at, `${label}中的成员`);
      return element === undefined ? [] : [element.node.name];
    });
  }

  function target(source: Source, node: TSType | undefined, at: Node, label: string): OpTarget | undefined {
    if (node?.type !== 'TSTypeReference' || constructorOf(source, node) !== 'OpRef') {
      problem(source, node ?? at, `${label}必须直接写成 OpRef`);
      return undefined;
    }
    const args = argumentsOf(node);
    const connection = named(source, args[0], node, `${label}的连接`);
    if (connection === undefined) return undefined;
    if (connection.node.kind !== 'Point' && connection.node.kind !== 'Face') {
      problem(source, args[0] ?? node, `${label}的连接「${connection.node.name}」必须是 Point 或 Face`);
      return undefined;
    }
    if (args[1] === undefined && connection.node.kind === 'Point') return { connection: connection.node.name, op: 'op' };
    if (args[1] === undefined) {
      problem(source, node, `${label}引用连接面「${connection.node.name}」时必须显式写出操作名`);
      return undefined;
    }
    const op = literal(source, args[1], node, `${label}的操作名`);
    return op === undefined ? undefined : { connection: connection.node.name, op };
  }

  function anchor(source: Source, node: TSType | undefined, at: Node, label: string): Anchor | undefined {
    if (constructorOf(source, node) === 'OpRef') {
      const operation = target(source, node, at, label);
      return operation === undefined ? undefined : { kind: 'Op', target: operation };
    }
    const element = named(source, node, at, label);
    if (element === undefined) return undefined;
    if (element.node.kind !== 'External') {
      problem(source, node ?? at, `${label}必须引用 External 节点或写成 OpRef`);
      return undefined;
    }
    return { kind: 'External', name: element.node.name };
  }

  function variants(source: Source, expression: TSTypeReference): readonly Member[] {
    return members(source, argumentsOf(expression)[1], expression, 'Outcome 的分支表');
  }

  function continuation(source: Source, owner: string, op: string | undefined, variant: Member): void {
    if (variant.value.type !== 'TSTypeReference' || constructorOf(source, variant.value) !== 'Variant') {
      problem(source, variant.value, `分支「${variant.name}」必须直接写成 Variant`);
      return;
    }
    const then = argumentsOf(variant.value)[2];
    if (then === undefined) return;
    const refs = tuple(source, then, variant.value, `分支「${variant.name}」的后续操作`);
    if (refs.length === 0) return;
    const targets = refs.flatMap(ref => {
      const operation = target(source, ref, variant.value, `分支「${variant.name}」的后续操作`);
      return operation === undefined ? [] : [operation];
    });
    continuations.push({ owner, op, variant: variant.name, then: targets });
  }

  function operation(source: Source, owner: string, name: string, node: TSType | undefined, at: Node): OpSpec | undefined {
    if (node?.type !== 'TSTypeReference' || constructorOf(source, node) !== 'Op') {
      problem(source, node ?? at, `连接「${owner}」的操作「${name}」必须直接写成 Op`);
      return undefined;
    }
    const args = argumentsOf(node);
    const doc = literal(source, args[0], node, `操作「${owner}.${name}」的说明`) ?? '';
    const result = args[2];
    const outcome = elementOf(source, result);
    if (outcome?.node.kind === 'Outcome') {
      return { name, doc, branches: variants(outcome.source, outcome.expression).map(variant => variant.name), outcome: outcome.node.name };
    }
    if (outcome?.node.kind === 'Value' || constructorOf(source, result) === 'Value') {
      return { name, doc, branches: ['done'], outcome: undefined };
    }
    if (result?.type === 'TSTypeReference' && constructorOf(source, result) === 'Outcome') {
      const branches = variants(source, result);
      for (const variant of branches) continuation(source, owner, name, variant);
      return { name, doc, branches: branches.map(variant => variant.name), outcome: undefined };
    }
    problem(source, result ?? node, `操作「${owner}.${name}」的结果必须是具名或内联的 Outcome 或 Value`);
    return { name, doc, branches: [], outcome: undefined };
  }

  function laws(source: Source, node: TSType | undefined, at: Node): readonly string[] {
    if (node === undefined) return [];
    return tuple(source, node, at, '连接的定律').flatMap(item => {
      const law = literal(source, item, at, '连接的定律');
      return law === undefined ? [] : [law];
    });
  }

  readDirectory(join(root, 'architecture'), 'architecture');
  readDirectory(join(root, 'business'), 'business');
  for (const source of sources.values()) {
    for (const alias of source.aliases.values()) {
      if (alias.typeParameters !== null && alias.typeParameters !== undefined) continue;
      const expression = alias.typeAnnotation;
      const kind = constructorOf(source, expression);
      if (expression.type !== 'TSTypeReference' || kind === undefined || !isNodeKind(kind)) continue;
      const node: DesignNode = {
        name: alias.id.name, kind,
        doc: literal(source, argumentsOf(expression)[0], alias, `节点「${alias.id.name}」的说明`) ?? '',
        layer: source.layer, place: source.place, at: location(source, alias),
      };
      const element: Element = { source, alias, expression, node };
      nodes.push(node);
      elements.push(element);
      byAlias.set(alias, element);
    }
  }

  for (const { source, alias, expression, node } of elements) {
    const args = argumentsOf(expression);
    switch (node.kind) {
      case 'Value': case 'Opaque': case 'Struct': case 'External': break;
      case 'Outcome': {
        const branches = variants(source, expression);
        outcomes.push({ name: node.name, branches: branches.map(variant => variant.name) });
        for (const variant of branches) continuation(source, node.name, undefined, variant);
        break;
      }
      case 'Point': {
        const op = operation(source, node.name, 'op', args[1], expression);
        connections.push({ name: node.name, shape: 'Point', invariant: undefined, ops: op === undefined ? [] : [op], laws: laws(source, args[2], expression) });
        break;
      }
      case 'Face': {
        const invariant = literal(source, args[1], expression, `连接面「${node.name}」的不变量`);
        const ops = members(source, args[2], expression, `连接面「${node.name}」的操作表`).flatMap(member => {
          const op = operation(source, node.name, member.name, member.value, member.at);
          return op === undefined ? [] : [op];
        });
        connections.push({ name: node.name, shape: 'Face', invariant, ops, laws: laws(source, args[3], expression) });
        break;
      }
      case 'Module': {
        const spec = members(source, args[1], expression, `模块「${node.name}」的组成`);
        const list = (key: string): readonly string[] => {
          const member = spec.find(member => member.name === key);
          return member === undefined ? [] : names(source, member.value, member.at, `模块「${node.name}」的 ${key}`);
        };
        modules.push({ name: node.name, provides: list('provides'), requires: list('requires'), core: list('core'), parts: list('parts') });
        break;
      }
      case 'Unit': {
        const spec = members(source, args[1], expression, `业务单元「${node.name}」的组成`);
        const list = (key: string): readonly string[] => {
          const member = spec.find(member => member.name === key);
          return member === undefined ? [] : names(source, member.value, member.at, `业务单元「${node.name}」的 ${key}`);
        };
        units.push({ name: node.name, plugsInto: list('plugsInto'), provides: list('provides'), types: list('types') });
        break;
      }
      case 'Scope': {
        const kind = literal(source, args[1], expression, `范围「${node.name}」的包含种类`);
        const contains = names(source, args[2], expression, `范围「${node.name}」的 contains`);
        if (kind === 'process' || kind === 'lifecycle' || kind === 'trust' || kind === 'deploy') {
          scopes.push({ name: node.name, kind, contains });
        } else if (kind !== undefined) problem(source, args[1] ?? expression, `范围「${node.name}」的包含种类必须是 process、lifecycle、trust 或 deploy`);
        break;
      }
      case 'Lifecycle': {
        const start = anchor(source, args[1], expression, `生命周期「${node.name}」的开始锚点`);
        const end = anchor(source, args[2], expression, `生命周期「${node.name}」的结束锚点`);
        if (start !== undefined && end !== undefined) lifecycles.push({ name: node.name, start, end });
        break;
      }
      case 'Scenario': {
        const steps: StepSpec[] = [];
        for (const step of tuple(source, args[1], expression, `场景「${node.name}」的步骤`)) {
          if (step.type !== 'TSTypeReference' || constructorOf(source, step) !== 'Step') {
            problem(source, step, `场景「${node.name}」的每一步必须直接写成 Step`);
            continue;
          }
          const stepArgs = argumentsOf(step);
          const actor = named(source, stepArgs[0], step, `场景「${node.name}」步骤的参与方`);
          const via = target(source, stepArgs[1], step, `场景「${node.name}」步骤的调用`);
          const take = literal(source, stepArgs[2], step, `场景「${node.name}」步骤的结局分支`);
          if (actor !== undefined && via !== undefined && take !== undefined) steps.push({ actor: actor.node.name, target: via, take, at: location(source, step) });
        }
        scenarios.push({ name: node.name, steps });
        break;
      }
      default: assertNever(node.kind);
    }
    walk(alias.typeAnnotation, reference => {
      if (reference.type !== 'TSTypeReference') return;
      const target = elementOf(source, reference);
      if (target !== undefined) references.push({ from: node.name, to: target.node.name, at: location(source, reference) });
    });
  }
  return { nodes, connections, outcomes, modules, units, scopes, lifecycles, scenarios, continuations, references, problems };
}
