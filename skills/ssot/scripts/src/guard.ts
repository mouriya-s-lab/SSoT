// 边界上的类型收窄：外部来的值先确认是一个对象，字段仍是 unknown，由调用处逐个检查。
export type UnknownRecord = Readonly<Record<string, unknown>>;

export function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;
}
