// `check --scope <视图> --base <rev>`：列出 <rev> 之后落在作用域之外的设计改动，并提示应交给哪个叶子。只提示，不影响退出码。
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { type Structure, compileLikeC4 } from "./compile/likec4";
import type { QuintModule } from "./compile/quint";
import { element, relation, view } from "./diag";
import { type Scope, inScope } from "./scope";
import { type Slice, behaviorSlice, contractSlice, elementSlice, relationSlice, viewSlice } from "./slices";

export interface Change {
  readonly path: string;
  readonly what: string;
  /** null：不属于任何切片（不是三种载体的文件）。 */
  readonly owner: Slice | null;
}

export type BaseResult = { readonly kind: "ok"; readonly changes: readonly Change[] } | { readonly kind: "failed"; readonly message: string };

function git(cwd: string, args: readonly string[]): { readonly ok: boolean; readonly out: string } {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.exitCode === 0 ? r.stdout.toString() : r.stderr.toString() };
}

const lines = (text: string): string[] => text.split("\n").filter((l) => l.length > 0);

/** 在 <rev> 时的 structure/*.c4 编译出的结构；那时没有结构文件时为空结构。 */
async function structureAt(top: string, rel: string, rev: string): Promise<Structure | string> {
  const files = git(top, ["ls-tree", "-r", "--name-only", rev, "--", join(rel, "structure")]);
  if (!files.ok) return files.out.trim();
  const dir = mkdtempSync("/tmp/ssot-base-");
  for (const f of lines(files.out).filter((x) => x.endsWith(".c4"))) {
    const shown = git(top, ["show", `${rev}:${f}`]);
    if (!shown.ok) return shown.out.trim();
    const target = join(dir, relative(join(rel, "structure"), f));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, shown.out);
  }
  const c4 = await compileLikeC4(dir);
  return c4.kind === "ok" ? c4.structure : `${rev} 时的结构编译失败：${c4.diagnostics.map((d) => d.message).join("；")}`;
}

/** 结构里改动过的元素、关系与视图（按模型 API 的投影比较，不比较文本）。 */
function structureChanges(before: Structure, after: Structure, scope: Scope, path: string): Change[] {
  const out: Change[] = [];
  const pickElement = (s: Structure, fqn: string): string => {
    const e = s.elements.get(fqn);
    return e ? JSON.stringify([e.kind, e.title, e.description, [...e.tags].sort(), e.metadata, e.parent]) : "";
  };
  for (const fqn of new Set([...before.elements.keys(), ...after.elements.keys()])) {
    if (pickElement(before, fqn) === pickElement(after, fqn)) continue;
    if (inScope(scope, element(fqn))) continue;
    const s = after.elements.has(fqn) ? after : before;
    out.push({ path, what: `元素 ${fqn}${after.elements.has(fqn) ? (before.elements.has(fqn) ? " 改动" : " 新增") : " 删除"}`, owner: elementSlice(s, fqn) });
  }
  const relationKeys = (s: Structure): Map<string, { source: string; target: string }> =>
    new Map(s.relations.map((r) => [JSON.stringify([r.source, r.target, r.kind, r.title, [...r.tags].sort(), r.metadata]), { source: r.source, target: r.target }]));
  const rb = relationKeys(before);
  const ra = relationKeys(after);
  for (const [key, r] of [...[...rb].filter(([k]) => !ra.has(k)), ...[...ra].filter(([k]) => !rb.has(k))]) {
    if (inScope(scope, relation(r.source, r.target))) continue;
    out.push({ path, what: `关系 ${r.source} -> ${r.target}${ra.has(key) ? " 新增或改动" : " 删除或改动"}`, owner: relationSlice(ra.has(key) ? after : before, r.source, r.target) });
  }
  const pickView = (s: Structure, id: string): string => {
    const v = s.views.find((x) => x.id === id);
    return v ? JSON.stringify([v.type, v.viewOf, [...v.nodes].sort()]) : "";
  };
  for (const id of new Set([...before.views, ...after.views].filter((v) => v.declared).map((v) => v.id))) {
    if (pickView(before, id) === pickView(after, id) || inScope(scope, view(id))) continue;
    out.push({ path, what: `视图 ${id}`, owner: viewSlice(after.views.some((v) => v.id === id) ? after : before, id) });
  }
  return out;
}

export async function baseChanges(
  root: string,
  rev: string,
  scope: Extract<Scope, { kind: "view" }>,
  current: Structure,
  behavior: readonly QuintModule[],
  ownerOfModule: ReadonlyMap<string, string>,
): Promise<BaseResult> {
  const design = realpathSync(root);
  const top = git(design, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { kind: "failed", message: `设计目录不在 git 仓库里：${top.out.trim()}` };
  const toplevel = top.out.trim();
  if (!git(toplevel, ["rev-parse", "--verify", `${rev}^{commit}`]).ok) return { kind: "failed", message: `找不到提交 ${rev}` };
  const rel = relative(toplevel, design);
  const changed = new Set([
    ...lines(git(toplevel, ["diff", "--name-only", rev, "--", rel || "."]).out),
    ...lines(git(toplevel, ["ls-files", "--others", "--exclude-standard", "--", rel || "."]).out),
  ]);
  const changes: Change[] = [];
  let structureTouched: string | null = null;
  for (const file of [...changed].sort()) {
    const path = relative(rel, file);
    const [dir, ...restParts] = path.split("/");
    const name = restParts.join("/");
    if (dir === ".gen" || path === "requirements.md") continue; // 生成物；需求清单不属于任何视图切片。
    if (dir === "structure" && name.endsWith(".c4")) {
      structureTouched ??= path;
      continue;
    }
    if (dir === "contract" && name.endsWith(".vdmsl")) {
      const fqn = basename(name, ".vdmsl");
      if (!scope.nodes.has(fqn)) changes.push({ path, what: `契约模块 ${fqn}`, owner: contractSlice(fqn) });
      continue;
    }
    if (dir === "behavior" && name.endsWith(".qnt")) {
      const module = basename(name, ".qnt");
      const q = behavior.find((b) => b.name === module);
      const touches = q?.decls.some((d) => [...d.modules, ...(d.varType ? [d.varType.module] : [])].some((m) => scope.nodes.has(ownerOfModule.get(m) ?? ""))) ?? false;
      if (!touches) changes.push({ path, what: `行为模块 ${module}`, owner: behaviorSlice(module) });
      continue;
    }
    changes.push({ path, what: "不是三种载体的文件", owner: null });
  }
  if (structureTouched !== null) {
    const before = await structureAt(toplevel, rel, rev);
    if (typeof before === "string") changes.push({ path: structureTouched, what: `无法与 ${rev} 比较结构：${before}`, owner: null });
    else changes.push(...structureChanges(before, current, scope, "structure/"));
  }
  return { kind: "ok", changes };
}
