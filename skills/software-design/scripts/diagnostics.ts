import type { CombinationScope } from './model.ts';
export type Location = { readonly path: string; readonly line: number; readonly column: number };
export type StageCodes = {
  source: 'UnsafeInput' | 'InvalidLayout' | 'OutdatedGeneratedFile' | 'WriteFailed' | 'MissingDependency';
  typescript: 'CompilerUnavailable' | 'CompilerDiagnostic';
  resolve: 'InvalidDescriptor' | 'UnresolvedReference' | 'EmptyDescription' | 'UnknownMember';
  relations:
    | 'InvalidOwnership'
    | 'PrivateReference'
    | 'InvalidComposition'
    | 'InvalidBinding'
    | 'DependencyCycle'
    | 'InvalidScope'
    | 'InvalidScenario'
    | 'UnfulfilledDuty'
    | 'InvalidLifecycle'
    | 'DuplicateKey';
  markdown: 'InvalidMarkdown' | 'AmbiguousReference';
};
export type Stage = keyof StageCodes;
export type DiagnosticCode = StageCodes[Stage];
export type Diagnostic = {
  [S in Stage]: {
    readonly stage: S;
    readonly code: StageCodes[S];
    readonly at: Location;
    readonly message: string;
    readonly related: readonly Location[];
    readonly details?:
      | { readonly kind: 'Compiler'; readonly code: number; readonly text: string }
      | { readonly kind: 'Writes'; readonly written: readonly string[] };
  };
}[Stage];
export type Failure = {
  readonly kind: 'Rejected';
  readonly diagnostics: readonly [Diagnostic, ...Diagnostic[]];
};
export type Result<T> = { readonly kind: 'Accepted'; readonly value: T } | Failure;
export type ReviewTopic =
  | 'grounds-and-rationale'
  | 'description-meaning'
  | 'connection-laws'
  | 'timing-and-concurrency'
  | 'lifecycle-responsibility'
  | 'requirements-and-scenario-coverage'
  | 'unbound-composition-choices';
export type ReviewItem = { readonly topic: ReviewTopic; readonly at: Location; readonly message: string };
export type ReviewRequired = { readonly kind: 'ManualReviewRequired'; readonly items: readonly ReviewItem[] };
export type SourceEvidence = {
  readonly stage: 'source';
  readonly files: number;
  readonly facts: readonly ['bounded-source-set', 'managed-files-current'];
};
export type TypeScriptEvidence = {
  readonly stage: 'typescript';
  readonly projects: number;
  readonly facts: readonly ['type-construction', 'project-direction'];
};
export type ResolveEvidence = {
  readonly stage: 'resolve';
  readonly declarations: number;
  readonly facts: readonly ['resolved-symbols', 'complete-descriptors', 'transitive-references'];
};
export type RelationsEvidence = {
  readonly stage: 'relations';
  readonly elements: number;
  readonly facts: readonly [
    'ownership-and-public-contracts',
    'declared-capabilities-and-legal-bindings',
    'declared-composition-cycles-scopes-and-finite-scenarios',
  ];
};
export type MarkdownEvidence = {
  readonly stage: 'markdown';
  readonly documents: number;
  readonly facts: readonly ['document-shape', 'links-and-symbol-references'];
};
export type Evidence =
  SourceEvidence | TypeScriptEvidence | ResolveEvidence | RelationsEvidence | MarkdownEvidence;
export type CheckReport = {
  readonly kind: 'AutomaticallyChecked';
  readonly evidence: readonly [
    SourceEvidence,
    TypeScriptEvidence,
    ResolveEvidence,
    RelationsEvidence,
    MarkdownEvidence,
  ];
  readonly review: ReviewRequired;
  readonly combination: CombinationScope;
};
export function reject(diagnostics: readonly Diagnostic[]): Failure {
  const [first, ...rest] = diagnostics;
  if (!first) throw new Error('程序错误：拒绝结果缺少诊断');
  return { kind: 'Rejected', diagnostics: [first, ...rest] };
}
export function assertNever(value: never): never {
  throw new Error(`程序错误：未处理的 variant ${String(value)}`);
}
