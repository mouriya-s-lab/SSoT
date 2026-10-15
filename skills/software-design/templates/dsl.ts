/**
 * 设计 DSL。设计文件里的每个设计元素都用这里的类型写成；每个类型的第一个参数是这个元素的说明。
 * 本文件由 `design.ts init` 复制进设计目录，设计文件不修改它。
 */

// ---------------------------------------------------------------------------
// 高阶类型：连接的载体

/** 类型构造器：接收 `A`，产出 `type`；实现者用 `this['A']` 写出 `type`。 */
export interface TypeLambda {
  readonly A: unknown;
  readonly type: unknown;
}

/** 把类型构造器 `F` 应用到 `A`。 */
export type Kind<F extends TypeLambda, A> = (F & { readonly A: A })['type'];

/** 同步载体：结果直接返回。 */
export interface Sync extends TypeLambda {
  readonly type: this['A'];
}

/** 异步载体：结果以 Promise 返回。 */
export interface Async extends TypeLambda {
  readonly type: Promise<this['A']>;
}

// ---------------------------------------------------------------------------
// 标记

declare const element: unique symbol;
declare const opaque: unique symbol;

// ---------------------------------------------------------------------------
// 数据

/** 一个带说明的值；`T` 是普通 TypeScript 类型或另一个数据元素。 */
export type Value<D extends string, T> = {
  readonly [element]: 'Value';
  readonly doc: D;
  readonly type: T;
};

/** 使用方拿不到内部结构的值；说明写明它代表什么、由谁造出。 */
export type Opaque<D extends string> = {
  readonly [element]: 'Opaque';
  readonly doc: D;
};

/** 字段表：每个字段都是带说明的值。 */
export type Fields = { readonly [name: string]: AnyValue };

/** 一组一起出现的字段。 */
export type Struct<D extends string, F extends Fields> = {
  readonly [element]: 'Struct';
  readonly doc: D;
  readonly fields: F;
};

/** 结局中的一支；`Then` 列出使用方拿到这一支之后要走的操作。 */
export type Variant<D extends string, F extends Fields = {}, Then extends readonly AnyOpRef[] = []> = {
  readonly [element]: 'Variant';
  readonly doc: D;
  readonly fields: F;
  readonly then: Then;
};

/** 使用方必须区分处理的几类结局，闭合。 */
export type Outcome<D extends string, Vs extends { readonly [name: string]: AnyVariant }> = {
  readonly [element]: 'Outcome';
  readonly doc: D;
  readonly variants: Vs;
};

// ---------------------------------------------------------------------------
// 连接

/** 一个操作：参数是字段表，结果是一个值或一组结局。 */
export type Op<D extends string, Params extends Fields, Result extends AnyValue | AnyOutcome> = {
  readonly [element]: 'Op';
  readonly doc: D;
  readonly params: Params;
  readonly result: Result;
};

/** 连接点：一个操作，一个接入方。`Laws` 是实现接入必须满足、类型强制不了的定律。 */
export type Point<D extends string, O extends AnyOp, Laws extends readonly string[] = []> = {
  readonly [element]: 'Point';
  readonly doc: D;
  readonly op: O;
  readonly laws: Laws;
};

/** 连接面：共享 `Invariant` 这条不变量、必须由同一个实现提供的一组操作。 */
export type Face<
  D extends string,
  Invariant extends string,
  Ops extends { readonly [name: string]: AnyOp },
  Laws extends readonly string[] = [],
> = {
  readonly [element]: 'Face';
  readonly doc: D;
  readonly invariant: Invariant;
  readonly ops: Ops;
  readonly laws: Laws;
};

/** 连接点或连接面。 */
export type Connection = AnyPoint | AnyFace;

/** 连接上可引用的操作名：面是它的操作名，点是 `'op'`。 */
export type OpName<C extends Connection> =
  C extends Face<any, any, infer Ops, any> ? keyof Ops & string : C extends AnyPoint ? 'op' : never;

/** 指向连接上的一个操作；面必须写出操作名。 */
export type OpRef<C extends Connection, K extends OpName<C> = OpName<C>> = {
  readonly [element]: 'OpRef';
  readonly connection: C;
  readonly name: K;
};

/** 引用的操作的结局分支名；结果是单个值时为 `'done'`。 */
export type Branch<R extends AnyOpRef> =
  R extends OpRef<infer C, infer K>
    ? OpOf<C, K>['result'] extends Outcome<any, infer Vs>
      ? keyof Vs & string
      : 'done'
    : never;

type OpOf<C, K> =
  C extends Face<any, any, infer Ops, any> ? (K extends keyof Ops ? Ops[K] : never) : C extends Point<any, infer O, any> ? O : never;

// ---------------------------------------------------------------------------
// 结构

/** 设计之外的事件或参与方，例如用户操作、外部系统的回调。 */
export type External<D extends string> = {
  readonly [element]: 'External';
  readonly doc: D;
};

/** 生命周期的锚点：一个操作，或一个设计之外的事件。 */
export type Anchor = AnyOpRef | AnyExternal;

/** 一段生命周期：从 `Start` 开始，到 `End` 结束；说明写明由谁确认结束。 */
export type Lifecycle<D extends string, Start extends Anchor, End extends Anchor> = {
  readonly [element]: 'Lifecycle';
  readonly doc: D;
  readonly start: Start;
  readonly end: End;
};

/** 架构模块：提供与需要的连接、核心元素、组成它的子模块。 */
export type Module<
  D extends string,
  S extends {
    readonly provides?: readonly Connection[];
    readonly requires?: readonly Connection[];
    readonly core?: readonly CoreElement[];
    readonly parts?: readonly AnyModule[];
  },
> = {
  readonly [element]: 'Module';
  readonly doc: D;
  readonly spec: S;
};

/** 业务单元：接在哪些连接上、向其他业务单元提供哪些连接、自己的类型。 */
export type Unit<
  D extends string,
  S extends {
    readonly plugsInto: readonly Connection[];
    readonly provides?: readonly Connection[];
    readonly types?: readonly CoreElement[];
  },
> = {
  readonly [element]: 'Unit';
  readonly doc: D;
  readonly spec: S;
};

/** 包含的种类。 */
export type ScopeKind = 'process' | 'lifecycle' | 'trust' | 'deploy';

/** 一种包含关系中的一个范围：谁在它里面。 */
export type Scope<D extends string, K extends ScopeKind, Contains extends readonly (AnyModule | AnyUnit | AnyScope | AnyExternal)[]> = {
  readonly [element]: 'Scope';
  readonly doc: D;
  readonly kind: K;
  readonly contains: Contains;
};

/** 场景中的一步：`Actor` 经 `Via` 调用一个操作，走 `Take` 这一个结局分支。 */
export type Step<Actor extends AnyModule | AnyUnit | AnyExternal, Via extends AnyOpRef, Take extends Branch<Via>> = {
  readonly [element]: 'Step';
  readonly actor: Actor;
  readonly via: Via;
  readonly take: Take;
};

/** 一个场景：沿连接逐步走通的一条路径，包括失败分支。 */
export type Scenario<D extends string, Steps extends readonly AnyStep[]> = {
  readonly [element]: 'Scenario';
  readonly doc: D;
  readonly steps: Steps;
};

// ---------------------------------------------------------------------------
// 元素的上界

export type AnyValue = Value<any, unknown>;
export type AnyOpaque = Opaque<any>;
export type AnyStruct = Struct<any, Fields>;
export type AnyVariant = Variant<any, Fields, readonly AnyOpRef[]>;
export type AnyOutcome = Outcome<any, { readonly [name: string]: AnyVariant }>;
export type AnyOp = Op<any, Fields, AnyValue | AnyOutcome>;
export type AnyPoint = Point<any, AnyOp, readonly string[]>;
export type AnyFace = Face<any, any, { readonly [name: string]: AnyOp }, readonly string[]>;
export type AnyOpRef = { readonly [element]: 'OpRef'; readonly connection: Connection; readonly name: string };
export type AnyExternal = External<any>;
export type AnyLifecycle = Lifecycle<any, Anchor, Anchor>;
export type AnyModule = { readonly [element]: 'Module'; readonly doc: string; readonly spec: object };
export type AnyUnit = { readonly [element]: 'Unit'; readonly doc: string; readonly spec: object };
export type AnyScope = { readonly [element]: 'Scope'; readonly doc: string; readonly kind: ScopeKind; readonly contains: readonly unknown[] };
export type AnyStep = { readonly [element]: 'Step'; readonly actor: unknown; readonly via: AnyOpRef; readonly take: string };

/** 模块或业务单元自己拥有的元素。 */
export type CoreElement = AnyValue | AnyOpaque | AnyStruct | AnyOutcome | AnyLifecycle;

// ---------------------------------------------------------------------------
// 投影：从设计元素得到普通 TypeScript 形状，实现可以用，也可以不用

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** 数据元素对应的形状。 */
export type Shape<X> =
  X extends Value<any, infer T>
    ? Shape<T>
    : X extends Opaque<infer D>
      ? { readonly [opaque]: D }
      : X extends Struct<any, infer F>
        ? ShapeOfFields<F>
        : X extends Outcome<any, infer Vs>
          ? { [K in keyof Vs]: Simplify<{ readonly kind: K } & ShapeOfFields<Vs[K]['fields']>> }[keyof Vs]
          : X;

type ShapeOfFields<F> = Simplify<{ readonly [K in keyof F]: Shape<F[K]> }>;

/** 操作在载体 `F` 上的签名。 */
export type Signature<F extends TypeLambda, O extends AnyOp> = (params: ShapeOfFields<O['params']>) => Kind<F, Shape<O['result']>>;

/** 连接在载体 `F` 上的实现形状。 */
export type Implementation<F extends TypeLambda, C extends Connection> =
  C extends Face<any, any, infer Ops, any>
    ? { readonly [K in keyof Ops]: Signature<F, Ops[K]> }
    : C extends Point<any, infer O, any>
      ? Signature<F, O>
      : never;
