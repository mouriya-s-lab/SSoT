import type { Location } from '../../software-design/scripts/diagnostics.ts';
import type {
  Binding,
  CarrierUse,
  Completion,
  DataCase,
  DataExpression,
  Duty,
  Element,
  ElementId,
  Exposure,
  Fact,
  Field,
  Operation,
  Selection,
  Step,
  Variant,
} from '../../software-design/scripts/model.ts';
export type Relation =
  | 'owns'
  | 'can-provide'
  | 'uses'
  | 'contract'
  | 'candidate'
  | 'exposes'
  | 'forwarded-from'
  | 'part'
  | 'public-material'
  | 'field'
  | 'parameter'
  | 'result'
  | 'case'
  | 'carrier'
  | 'applies'
  | 'type-argument'
  | 'reference'
  | 'next'
  | 'duty'
  | 'completes'
  | 'starts'
  | 'ends'
  | 'key'
  | 'within'
  | 'confirms'
  | 'contains'
  | 'step'
  | 'takes'
  | 'handoff'
  | 'composition'
  | 'binding'
  | 'bound-to';
export type NodeBase = {
  readonly id: string;
  readonly name: string;
  readonly doc: string;
  readonly at: Location;
};
export type ElementNode = {
  [K in Element['kind']]: NodeBase & { readonly kind: K; readonly details: Extract<Element, { kind: K }> };
}[Element['kind']];
export type MemberPayload = {
  Operation: Operation;
  Field: Field;
  Case: DataCase;
  Variant: Variant;
  Duty: Duty;
  Fact: Fact;
  Step: Step;
  Application: DataExpression;
  Expose: Exposure;
  Binding: Binding;
  Role: Selection;
  Completion: Completion;
  CarrierMember: Extract<CarrierUse, { kind: 'Inline' }>;
};
export type MemberNode = {
  [K in keyof MemberPayload]: NodeBase & { readonly kind: K; readonly details: MemberPayload[K] };
}[keyof MemberPayload];
export type GraphNode = ElementNode | MemberNode;
export type GraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly relation: Relation;
  readonly label: string;
  readonly at: Location;
};
export type GraphContext =
  { readonly kind: 'Contracts' } | { readonly kind: 'Composition'; readonly composition: ElementId };
export type Graph = {
  readonly context: GraphContext;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly out: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly incoming: ReadonlyMap<string, readonly GraphEdge[]>;
};
export type QueryError =
  | { readonly kind: 'Missing'; readonly selector: string }
  | { readonly kind: 'Ambiguous'; readonly selector: string; readonly candidates: readonly string[] };
export type QueryResult<T> = { readonly kind: 'Found'; readonly value: T } | QueryError;
export type Neighborhood = {
  readonly context: GraphContext;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};
export type PathResult =
  | {
      readonly kind: 'StructuralPath';
      readonly context: GraphContext;
      readonly edges: readonly GraphEdge[];
      readonly roles: readonly Selection[];
    }
  | { readonly kind: 'NoPath'; readonly context: GraphContext };
