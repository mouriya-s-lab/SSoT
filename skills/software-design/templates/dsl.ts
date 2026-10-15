/** 代码化设计：类型保存说明，投影只解释显式描述的数据。 */
declare const descriptor: unique symbol;
declare const opaque: unique symbol;
declare const familyArgument: unique symbol;
type Tag<K extends string> = { readonly [descriptor]: true; readonly design: K };
type Described<K extends string, D extends string> = Tag<K> & { readonly doc: D };

/** F 接收已经投影的 A；不对 F 的原生输出再递归。 */
export interface TypeLambda {
  readonly A: unknown;
  readonly type: unknown;
}
export type Kind<F extends TypeLambda, A> = (F & { readonly A: A })['type'];
export interface Sync extends TypeLambda {
  readonly type: this['A'];
}
export interface Async extends TypeLambda {
  readonly type: Promise<this['A']>;
}
export type Scalar = string | number | boolean | bigint | symbol | null | undefined | void;
export type Fields = { readonly [name: string]: Data };
export type Cases = { readonly [name: string]: Described<'Case', string> & { readonly fields: Fields } };
export type Variants = {
  readonly [name: string]: Described<'Variant', string> & {
    readonly fields: Fields;
    readonly follow: Follow;
  };
};
export type Data =
  | (Described<'Value', string> & { readonly type: Scalar | Data })
  | (Described<'Opaque', string> & { readonly key: string })
  | (Described<'Struct', string> & { readonly fields: Fields })
  | (Described<'Tuple', string> & { readonly items: readonly Data[] })
  | (Described<'Apply', string> & { readonly lambda: TypeLambda; readonly argument: Data })
  | (Described<'Choice', string> & { readonly cases: Cases })
  | (Described<'Outcome', string> & { readonly variants: Variants });
export type Value<D extends string, T extends Scalar | Data> = Described<'Value', D> & { readonly type: T };
export type Opaque<D extends string, K extends string> = Described<'Opaque', D> & { readonly key: K };
export type Struct<D extends string, F extends Fields> = Described<'Struct', D> & { readonly fields: F };
export type Tuple<D extends string, I extends readonly Data[]> = Described<'Tuple', D> & {
  readonly items: I;
};
export type Apply<D extends string, F extends TypeLambda, A extends Data> = Described<'Apply', D> & {
  readonly lambda: F;
  readonly argument: A;
};
export type Case<D extends string, F extends Fields = Record<never, never>> = Described<'Case', D> & {
  readonly fields: F;
};
export type Choice<D extends string, C extends Cases> = Described<'Choice', D> & { readonly cases: C };
/** 公开的类型构造器；私有 TypeLambda 辅助定义不必成为领域术语。 */
export type Family<D extends string, F extends TypeLambda> = F &
  Described<'Family', D> & { readonly [familyArgument]: F };
/** K 只在同一连接的载体选项内唯一；定律不是类型相容性的推论。 */
export type Carrier<
  D extends string,
  K extends string,
  F extends TypeLambda,
  Laws extends readonly string[],
> = Described<'Carrier', D> & { readonly key: K; readonly lambda: F; readonly laws: Laws };
export type AnyCarrier = Described<'Carrier', string> & {
  readonly key: string;
  readonly lambda: TypeLambda;
  readonly laws: readonly string[];
};
export type Op<D extends string, Params extends Fields, Result extends Data> = Described<'Op', D> & {
  readonly params: Params;
  readonly result: Result;
};
export type AnyOp = Described<'Op', string> & { readonly params: Fields; readonly result: Data };
export type Point<
  D extends string,
  O extends AnyOp,
  Modes extends readonly [AnyCarrier, ...AnyCarrier[]],
  Laws extends readonly string[] = [],
> = Described<'Point', D> & { readonly op: O; readonly carriers: Modes; readonly laws: Laws };
export type Face<
  D extends string,
  Invariant extends string,
  Ops extends { readonly [name: string]: AnyOp },
  Modes extends readonly [AnyCarrier, ...AnyCarrier[]],
  Laws extends readonly string[] = [],
> = Described<'Face', D> & {
  readonly invariant: Invariant;
  readonly ops: Ops;
  readonly carriers: Modes;
  readonly laws: Laws;
};
export type Connection =
  | (Described<'Point', string> & {
      readonly op: AnyOp;
      readonly carriers: readonly AnyCarrier[];
      readonly laws: readonly string[];
    })
  | (Described<'Face', string> & {
      readonly invariant: string;
      readonly ops: { readonly [name: string]: AnyOp };
      readonly carriers: readonly AnyCarrier[];
      readonly laws: readonly string[];
    });
export type OpName<C extends Connection> = C extends { readonly design: 'Point' }
  ? 'op'
  : C extends { readonly design: 'Face'; readonly ops: infer O }
    ? keyof O & string
    : never;
export type OpRef<C extends Connection, K extends OpName<C> = OpName<C>> = Tag<'OpRef'> & {
  readonly connection: C;
  readonly name: K;
};
export type AnyOpRef = Tag<'OpRef'> & { readonly connection: Connection; readonly name: string };
type Operation<C extends Connection, K extends string> = C extends {
  readonly design: 'Point';
  readonly op: infer O extends AnyOp;
}
  ? O
  : C extends { readonly design: 'Face'; readonly ops: infer O }
    ? K extends keyof O
      ? O[K]
      : never
    : never;
export type Branch<R extends AnyOpRef> =
  Operation<R['connection'], R['name']> extends { readonly result: infer O extends Data }
    ? O extends { readonly design: 'Outcome'; readonly variants: infer V }
      ? keyof V & string
      : 'done'
    : never;
export type Returned<R extends AnyOpRef, B extends Branch<R>> = Tag<'Returned'> & {
  readonly via: R;
  readonly branch: B;
};
export type Participant = AnyModule | AnyUnit | AnyExternal;
export type Event<D extends string, By extends Participant, Payload extends Data> = Described<'Event', D> & {
  readonly confirms: By;
  readonly payload: Payload;
};
export type AnyEvent = Described<'Event', string> & {
  readonly confirms: Participant;
  readonly payload: Data;
};
export type Occurred<E extends AnyEvent> = Tag<'Occurred'> & { readonly event: E };
export type Fact =
  | (Tag<'Returned'> & { readonly via: AnyOpRef; readonly branch: string })
  | (Tag<'Occurred'> & { readonly event: AnyEvent });
export type Duty<
  D extends string,
  By extends 'caller' | 'provider' | Participant,
  CompleteFact extends Fact,
> = Described<'Duty', D> & { readonly by: By; readonly complete: CompleteFact };
export type AnyDuty = Described<'Duty', string> & {
  readonly by: 'caller' | 'provider' | Participant;
  readonly complete: Fact;
};
export type End = Tag<'End'>;
/** 只约束产生本后继的调用方的下一次 Call；其他参与方和事件可穿插。 */
export type Next<
  D extends string,
  Targets extends readonly [AnyOpRef, ...AnyOpRef[]],
  Duties extends readonly AnyDuty[] = [],
> = Described<'Next', D> & { readonly targets: Targets; readonly duties: Duties };
export type Later<D extends string, Duties extends readonly [AnyDuty, ...AnyDuty[]]> = Described<
  'Later',
  D
> & { readonly duties: Duties };
export type Follow =
  | End
  | (Described<'Next', string> & {
      readonly targets: readonly AnyOpRef[];
      readonly duties: readonly AnyDuty[];
    })
  | (Described<'Later', string> & { readonly duties: readonly AnyDuty[] });
export type Variant<
  D extends string,
  F extends Fields = Record<never, never>,
  After extends Follow = End,
> = Described<'Variant', D> & { readonly fields: F; readonly follow: After };
export type Outcome<D extends string, V extends Variants> = Described<'Outcome', D> & {
  readonly variants: V;
};

export type Expose<D extends string, C extends Connection, From extends AnyModule | AnyExternal> = Described<
  'Expose',
  D
> & { readonly connection: C; readonly from: From };
export type AnyExpose = Described<'Expose', string> & {
  readonly connection: Connection;
  readonly from: AnyModule | AnyExternal;
};
export type ModuleSpec = {
  readonly core?: readonly Core[];
  readonly ports?: readonly Connection[];
  readonly provides?: readonly Connection[];
  readonly requires?: readonly Connection[];
  readonly public?: readonly (Data | AnyEvent | AnyLifecycle)[];
  readonly parts?: readonly AnyModule[];
  readonly reexports?: readonly AnyExpose[];
};
export type Module<
  D extends string,
  S extends ModuleSpec & { readonly [K in Exclude<keyof S, keyof ModuleSpec>]: never },
> = Described<'Module', D> & { readonly spec: S };
export type AnyModule = Described<'Module', string> & { readonly spec: ModuleSpec };
export type UnitSpec = {
  readonly types?: readonly Core[];
  readonly ports?: readonly Connection[];
  readonly provides?: readonly Connection[];
  readonly plugsInto: readonly Connection[];
};
export type Unit<
  D extends string,
  S extends UnitSpec & { readonly [K in Exclude<keyof S, keyof UnitSpec>]: never },
> = Described<'Unit', D> & { readonly spec: S };
export type AnyUnit = Described<'Unit', string> & { readonly spec: UnitSpec };
export type ExternalSpec = {
  readonly provides?: readonly Connection[];
  readonly uses?: readonly Connection[];
};
export type External<
  D extends string,
  S extends ExternalSpec & { readonly [K in Exclude<keyof S, keyof ExternalSpec>]: never },
> = Described<'External', D> & { readonly spec: S };
export type AnyExternal = Described<'External', string> & { readonly spec: ExternalSpec };
export type LifecycleSpec = {
  readonly key: Data;
  readonly starts: Fact;
  readonly ends: Fact;
  readonly within?: AnyLifecycle;
};
export type Lifecycle<
  D extends string,
  S extends LifecycleSpec & { readonly [K in Exclude<keyof S, keyof LifecycleSpec>]: never },
> = Described<'Lifecycle', D> & { readonly spec: S };
export type AnyLifecycle = Described<'Lifecycle', string> & { readonly spec: LifecycleSpec };
export type AnyFamily = TypeLambda & Described<'Family', string>;
export type Core = Data | AnyFamily | AnyCarrier | AnyLifecycle | AnyEvent;
export type ScopeKind = 'process' | 'lifecycle' | 'trust' | 'deploy';
export type Scope<
  D extends string,
  K extends ScopeKind,
  Members extends readonly (Participant | AnyScope<K>)[],
> = Described<'Scope', D> & { readonly kind: K; readonly contains: Members };
export type AnyScope<K extends ScopeKind = ScopeKind> = Described<'Scope', string> & {
  readonly kind: K;
  readonly contains: readonly (Participant | AnyScope<K>)[];
};
/** 这些条件类型只分类参与方的声明，不把边界转交当作原始能力。 */
export type Used<P extends Participant> = P extends AnyModule
  ? P['spec'] extends { readonly requires: readonly (infer C extends Connection)[] }
    ? C
    : never
  : P extends AnyUnit
    ? P['spec']['plugsInto'][number]
    : P extends AnyExternal
      ? P['spec'] extends { readonly uses: readonly (infer C extends Connection)[] }
        ? C
        : never
      : never;
export type DeclaredProvided<P extends Participant> = P['spec'] extends {
  readonly provides: readonly (infer C extends Connection)[];
}
  ? C
  : never;
export type Binding<
  D extends string,
  Consumer extends Participant,
  C extends Used<Consumer> & DeclaredProvided<Provider>,
  Provider extends Participant,
> = Described<'Binding', D> & {
  readonly consumer: Consumer;
  readonly connection: C;
  readonly provider: Provider;
};
export type AnyBinding = Described<'Binding', string> & {
  readonly consumer: Participant;
  readonly connection: Connection;
  readonly provider: Participant;
};
export type Composition<D extends string, Bindings extends readonly AnyBinding[]> = Described<
  'Composition',
  D
> & { readonly bindings: Bindings };
export type AnyComposition = Described<'Composition', string> & { readonly bindings: readonly AnyBinding[] };
export type Uncomposed = Tag<'Uncomposed'>;
export type ScenarioAssembly = Uncomposed | AnyComposition;
export type Step<Actor extends Participant, Via extends AnyOpRef, Take extends Branch<Via>> = Tag<'Step'> & {
  readonly actor: Actor;
  readonly fact: Returned<Via, Take>;
};
export type EventStep<E extends AnyEvent> = Tag<'EventStep'> & { readonly fact: Occurred<E> };
export type AnyStep =
  | (Tag<'Step'> & {
      readonly actor: Participant;
      readonly fact: Tag<'Returned'> & { readonly via: AnyOpRef; readonly branch: string };
    })
  | (Tag<'EventStep'> & { readonly fact: Tag<'Occurred'> & { readonly event: AnyEvent } });
export type Complete = Tag<'Complete'>;
/** 最后一步就是中断事实；本描述只陈述接手方，不声称义务兑现。 */
export type Interrupted<D extends string, Responsible extends Participant> = Described<'Interrupted', D> & {
  readonly responsible: Responsible;
};
export type Completion =
  Complete | (Described<'Interrupted', string> & { readonly responsible: Participant });
export type Scenario<
  D extends string,
  Steps extends (Ends extends { readonly design: 'Interrupted' }
    ? readonly [AnyStep, ...AnyStep[]]
    : readonly AnyStep[]),
  Ends extends Completion = Complete,
  Assembly extends ScenarioAssembly = Uncomposed,
> = Described<'Scenario', D> & { readonly steps: Steps; readonly ends: Ends; readonly assembly: Assembly };

type Shapes<F extends Fields> = { readonly [K in keyof F]: Shape<F[K]> };
type CaseShapes<C extends Cases> = {
  [K in keyof C]: { readonly case: K; readonly fields: Shapes<C[K]['fields']> };
}[keyof C];
type VariantShapes<V extends Variants> = {
  [K in keyof V]: { readonly case: K; readonly fields: Shapes<V[K]['fields']> };
}[keyof V];
/** 唯一投影：DSL 递归在 Apply 的参数处结束，原生容器输出不再扫描。 */
export type Shape<X extends Data> = X extends {
  readonly design: 'Value';
  readonly type: infer T extends Scalar | Data;
}
  ? T extends Data
    ? Shape<T>
    : T
  : X extends { readonly design: 'Opaque'; readonly key: infer K extends string }
    ? { readonly [opaque]: K }
    : X extends { readonly design: 'Struct'; readonly fields: infer F extends Fields }
      ? Shapes<F>
      : X extends { readonly design: 'Tuple'; readonly items: infer I extends readonly Data[] }
        ? { readonly [K in keyof I]: Shape<I[K]> }
        : X extends {
              readonly design: 'Apply';
              readonly lambda: infer F extends TypeLambda;
              readonly argument: infer A extends Data;
            }
          ? Kind<F, Shape<A>>
          : X extends { readonly design: 'Choice'; readonly cases: infer C extends Cases }
            ? CaseShapes<C>
            : X extends { readonly design: 'Outcome'; readonly variants: infer V extends Variants }
              ? VariantShapes<V>
              : never;
export type CarrierOf<C extends Connection> = C['carriers'][number];
export type Signature<F extends AnyCarrier, O extends AnyOp> = (
  params: Shapes<O['params']>,
) => Kind<F['lambda'], Shape<O['result']>>;
export type Implementation<F extends CarrierOf<C>, C extends Connection> = C extends {
  readonly design: 'Point';
  readonly op: infer O extends AnyOp;
}
  ? Signature<F, O>
  : C extends { readonly design: 'Face'; readonly ops: infer O extends { readonly [name: string]: AnyOp } }
    ? { readonly [K in keyof O]: Signature<F, O[K]> }
    : never;
