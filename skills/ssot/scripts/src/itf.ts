// ITF（Informal Trace Format）值的边界解析。
export type ItfValue =
  | { readonly t: "int"; readonly v: bigint }
  | { readonly t: "str"; readonly v: string }
  | { readonly t: "bool"; readonly v: boolean }
  | { readonly t: "tup"; readonly items: readonly ItfValue[] }
  | { readonly t: "set"; readonly items: readonly ItfValue[] }
  | { readonly t: "list"; readonly items: readonly ItfValue[] }
  | { readonly t: "map"; readonly entries: readonly (readonly [ItfValue, ItfValue])[] }
  | { readonly t: "rec"; readonly fields: ReadonlyMap<string, ItfValue> }
  | { readonly t: "variant"; readonly tag: string; readonly value: ItfValue };

export interface ItfState {
  readonly vars: ReadonlyMap<string, ItfValue>;
  readonly action: string | null;
}

export interface ItfTrace {
  readonly file: string;
  readonly status: string | null;
  readonly states: readonly ItfState[];
}

export function parseItf(raw: unknown): ItfValue {
  if (typeof raw === "string") return { t: "str", v: raw };
  if (typeof raw === "boolean") return { t: "bool", v: raw };
  if (Array.isArray(raw)) return { t: "list", items: raw.map(parseItf) };
  if (raw === null || typeof raw !== "object") throw new Error(`ITF 中出现了不支持的值 ${JSON.stringify(raw)}`);
  const o = raw as Record<string, unknown>;
  if ("#bigint" in o) return { t: "int", v: BigInt(o["#bigint"] as string) };
  if ("#tup" in o) return { t: "tup", items: (o["#tup"] as unknown[]).map(parseItf) };
  if ("#set" in o) return { t: "set", items: (o["#set"] as unknown[]).map(parseItf) };
  if ("#map" in o) return { t: "map", entries: (o["#map"] as [unknown, unknown][]).map(([k, v]) => [parseItf(k), parseItf(v)] as const) };
  const keys = Object.keys(o);
  if (keys.length === 2 && "tag" in o && "value" in o && typeof o.tag === "string") return { t: "variant", tag: o.tag, value: parseItf(o.value) };
  return { t: "rec", fields: new Map(keys.map((k) => [k, parseItf(o[k])])) };
}

export async function readTrace(file: string): Promise<ItfTrace> {
  const raw = (await Bun.file(file).json()) as { "#meta"?: { status?: string }; states: Record<string, unknown>[] };
  return {
    file,
    status: raw["#meta"]?.status ?? null,
    states: raw.states.map((s) => {
      const vars = new Map<string, ItfValue>();
      let action: string | null = null;
      for (const [k, v] of Object.entries(s)) {
        if (k === "#meta" || k === "mbt::nondetPicks") continue;
        if (k === "mbt::actionTaken") action = typeof v === "string" ? v : null;
        else vars.set(k, parseItf(v));
      }
      return { vars, action };
    }),
  };
}
