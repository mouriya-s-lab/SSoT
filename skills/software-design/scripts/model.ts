import type { Location } from './diagnostics.ts';
export type ElementId = string;
export type Layer = 'architecture' | 'business' | 'relations';
export type Place = { readonly layer: Layer; readonly module: readonly string[] };
export type ElementUse = { readonly target: ElementId; readonly at: Location };
export type Named = {
  readonly id: ElementId;
  readonly name: string;
  readonly doc: string;
  readonly at: Location;
  readonly place: Place;
  readonly exported: boolean;
};
export type TypeExpression = { readonly text: string; readonly references: readonly ElementUse[] };
export type Field = {
  readonly name: string;
  readonly doc: string;
  readonly at: Location;
  readonly value: DataExpression;
};
export type DataCase = {
  readonly name: string;
  readonly doc: string;
  readonly at: Location;
  readonly fields: readonly Field[];
};
export type DataExpression =
  | { readonly kind: 'Reference'; readonly target: ElementId; readonly at: Location }
  | {
      readonly kind: 'Application';
      readonly definition: ElementUse;
      readonly arguments: readonly TypeExpression[];
      readonly resolved: DataExpression;
    }
  | { readonly kind: 'Parameter'; readonly name: string; readonly constraint: TypeExpression | undefined }
  | { readonly kind: 'Scalar'; readonly type: TypeExpression }
  | { readonly kind: 'Value'; readonly doc: string; readonly value: DataExpression }
  | { readonly kind: 'Opaque'; readonly doc: string; readonly key: string }
  | { readonly kind: 'Struct'; readonly doc: string; readonly fields: readonly Field[] }
  | { readonly kind: 'Tuple'; readonly doc: string; readonly items: readonly DataExpression[] }
  | {
      readonly kind: 'Apply';
      readonly doc: string;
      readonly lambda: TypeExpression;
      readonly argument: DataExpression;
    }
  | { readonly kind: 'Choice'; readonly doc: string; readonly cases: readonly DataCase[] }
  | { readonly kind: 'Outcome'; readonly doc: string; readonly variants: readonly Variant[] };
export type OperationRef = {
  readonly connection: ElementUse;
  readonly operation: string;
  readonly at: Location;
};
export type Fact = (
  | { readonly kind: 'Returned'; readonly via: OperationRef; readonly branch: string }
  | { readonly kind: 'Occurred'; readonly event: ElementUse }
) & { readonly at: Location };
export type Responsibility =
  | { readonly kind: 'Caller' }
  | { readonly kind: 'Provider' }
  | { readonly kind: 'Participant'; readonly participant: ElementUse };
export type Duty = {
  readonly doc: string;
  readonly at: Location;
  readonly by: Responsibility;
  readonly complete: Fact;
};
export type Follow =
  | { readonly kind: 'End' }
  | {
      readonly kind: 'Next';
      readonly doc: string;
      readonly targets: readonly OperationRef[];
      readonly duties: readonly Duty[];
    }
  | { readonly kind: 'Later'; readonly doc: string; readonly duties: readonly Duty[] };
export type Variant = DataCase & { readonly follow: Follow };
export type Operation = {
  readonly name: string;
  readonly doc: string;
  readonly at: Location;
  readonly params: readonly Field[];
  readonly result: DataExpression;
};
export type CarrierUse =
  | { readonly kind: 'Reference'; readonly carrier: ElementUse }
  | {
      readonly kind: 'Inline';
      readonly id: string;
      readonly at: Location;
      readonly doc: string;
      readonly key: string;
      readonly lambda: TypeExpression;
      readonly laws: readonly string[];
    };
export type Port = { readonly carriers: readonly CarrierUse[]; readonly laws: readonly string[] } & (
  | { readonly kind: 'Point'; readonly operation: Operation }
  | { readonly kind: 'Face'; readonly invariant: string; readonly operations: readonly Operation[] }
);
export type Exposure = {
  readonly doc: string;
  readonly at: Location;
  readonly by: ElementUse;
  readonly connection: ElementUse;
  readonly from: ElementUse;
};
export type Binding = {
  readonly doc: string;
  readonly at: Location;
  readonly consumer: ElementUse;
  readonly connection: ElementUse;
  readonly provider: ElementUse;
};
export type Module = Named & {
  readonly kind: 'Module';
  readonly core: readonly ElementUse[];
  readonly ports: readonly ElementUse[];
  readonly provides: readonly ElementUse[];
  readonly requires: readonly ElementUse[];
  readonly public: readonly ElementUse[];
  readonly parts: readonly ElementUse[];
  readonly reexports: readonly Exposure[];
};
export type Unit = Named & {
  readonly kind: 'Unit';
  readonly types: readonly ElementUse[];
  readonly ports: readonly ElementUse[];
  readonly provides: readonly ElementUse[];
  readonly plugsInto: readonly ElementUse[];
};
export type External = Named & {
  readonly kind: 'External';
  readonly provides: readonly ElementUse[];
  readonly uses: readonly ElementUse[];
};
export type Participant = Module | Unit | External;
export type Lifecycle = Named & {
  readonly kind: 'Lifecycle';
  readonly key: ElementUse;
  readonly starts: Fact;
  readonly ends: Fact;
  readonly within: ElementUse | undefined;
};
export type Step = (
  | { readonly kind: 'Call'; readonly actor: ElementUse; readonly fact: Extract<Fact, { kind: 'Returned' }> }
  | { readonly kind: 'Event'; readonly fact: Extract<Fact, { kind: 'Occurred' }> }
) & { readonly at: Location };
export type Completion =
  | { readonly kind: 'Complete' }
  | { readonly kind: 'Interrupted'; readonly doc: string; readonly responsible: ElementUse };
export type ScenarioContext =
  { readonly kind: 'Contracts' } | { readonly kind: 'Composition'; readonly composition: ElementUse };
export type Scenario = Named & {
  readonly kind: 'Scenario';
  readonly steps: readonly Step[];
  readonly ends: Completion;
  readonly context: ScenarioContext;
};
export type Element =
  | (Named & { readonly kind: 'Data'; readonly expression: DataExpression })
  | (Named & { readonly kind: 'Family'; readonly lambda: TypeExpression })
  | (Named & {
      readonly kind: 'Carrier';
      readonly key: string;
      readonly lambda: TypeExpression;
      readonly laws: readonly string[];
    })
  | (Named & { readonly kind: 'Connection'; readonly port: Port })
  | Module
  | Unit
  | External
  | Lifecycle
  | Scenario
  | (Named & { readonly kind: 'Event'; readonly confirms: ElementUse; readonly payload: DataExpression })
  | (Named & {
      readonly kind: 'Scope';
      readonly scopeKind: 'process' | 'lifecycle' | 'trust' | 'deploy';
      readonly contains: readonly ElementUse[];
    })
  | (Named & { readonly kind: 'Composition'; readonly bindings: readonly Binding[] })
  | (Named & { readonly kind: 'Auxiliary'; readonly expression: TypeExpression; readonly generic: boolean });
export type Reference = { readonly from: ElementId; readonly to: ElementId; readonly at: Location };
export type ResolvedDesign = {
  readonly root: string;
  readonly elements: readonly Element[];
  readonly references: readonly Reference[];
  readonly directories: readonly { readonly path: string; readonly place: Place }[];
};
export type Ownership = { readonly element: ElementId; readonly owner: ElementId };
export type Capability = { readonly connection: ElementUse; readonly provider: ElementUse };
export type Selection =
  | {
      readonly kind: 'Role';
      readonly consumer: ElementUse;
      readonly connection: ElementUse;
      readonly candidates: readonly ElementUse[];
    }
  | {
      readonly kind: 'Bound';
      readonly consumer: ElementUse;
      readonly connection: ElementUse;
      readonly provider: ElementUse;
      readonly composition: ElementId;
      readonly binding: number;
    };
export type CompositionContext = {
  readonly composition: ElementId;
  readonly selections: readonly Selection[];
};
export type CombinationScope =
  | { readonly kind: 'ContractOnly'; readonly roles: readonly Extract<Selection, { kind: 'Role' }>[] }
  | {
      readonly kind: 'WithCompositions';
      readonly roles: readonly Extract<Selection, { kind: 'Role' }>[];
      readonly contexts: readonly CompositionContext[];
    };
export type DutyMatch = {
  readonly duty: number;
  readonly completedAt: number;
  readonly basis: 'DeclaredParticipant' | 'SelectedBinding' | 'RoleWitness';
};
export type ScenarioFacts = {
  readonly scenario: ElementId;
  readonly context: ScenarioContext;
  readonly steps: readonly (
    | { readonly kind: 'Call'; readonly index: number; readonly selection: Selection }
    | { readonly kind: 'Event'; readonly index: number; readonly confirmer: ElementUse }
  )[];
  readonly matches: readonly DutyMatch[];
  readonly ending:
    | { readonly kind: 'Complete' }
    | {
        readonly kind: 'Interrupted';
        readonly responsible: ElementUse;
        readonly unmatchedDuties: readonly number[];
        readonly pendingNext: readonly { readonly actor: ElementId; readonly fromStep: number }[];
      };
};
export type RelationFacts = {
  readonly ownership: readonly Ownership[];
  readonly capabilities: readonly Capability[];
  readonly exposures: readonly Exposure[];
  readonly publicMaterials: readonly {
    readonly boundary: ElementId;
    readonly explicit: readonly ElementId[];
    readonly contracts: readonly {
      readonly connection: ElementId;
      readonly materials: readonly ElementId[];
    }[];
  }[];
  readonly contracts: readonly Selection[];
  readonly compositions: readonly CompositionContext[];
  readonly scenarios: readonly ScenarioFacts[];
};
export type NameResult =
  | { readonly kind: 'Found'; readonly id: ElementId }
  | { readonly kind: 'Missing' }
  | { readonly kind: 'Ambiguous'; readonly candidates: readonly ElementId[] };
/** Markdown 和 Graph 共用完整身份与唯一名称规则；调用方先提供可见集合。 */
export function lookup(elements: readonly Pick<Element, 'id' | 'name'>[], selector: string): NameResult {
  const exact = elements.find((e) => e.id === selector);
  if (exact) return { kind: 'Found', id: exact.id };
  const candidates = elements
    .filter((e) => e.name === selector)
    .map((e) => e.id)
    .sort();
  if (candidates.length === 0) return { kind: 'Missing' };
  if (candidates.length === 1) return { kind: 'Found', id: candidates[0]! };
  return { kind: 'Ambiguous', candidates };
}
