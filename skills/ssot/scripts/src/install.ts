// 安装位置：`ssot setup` 写入，运行时只从这里取 VDMJ、QuickCheck、LikeC4 与 Quint。不放在 skill 目录里，更新 skill 时不会被冲掉。
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { LikeC4 } from "likec4";
import type ELK from "elkjs/lib/elk.bundled.js";
import type { chromium } from "playwright-core";

export const DATA = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "ssot");
/** setup 把 `ssot` 命令装进这个目录；它必须在 PATH 上。 */
export const BIN = join(homedir(), ".local", "bin");
export const JARS = ["vdmj", "quickcheck"] as const;
export const SETUP_GUIDE = join(import.meta.dir, "..", "..", "references", "setup.md");

/** 依赖还没有装好：报告缺什么、怎样装，不是程序错误。 */
export class NotInstalled extends Error {}

const missing = (what: string): NotInstalled => new NotInstalled(`${what} 尚未安装到 ${DATA}：先运行 ssot setup，见 ${SETUP_GUIDE}`);

export function vdmClasspath(): string {
  const jars = JARS.map((a) => join(DATA, `${a}.jar`));
  if (!jars.every((j) => existsSync(j))) throw missing("VDMJ 与 QuickCheck");
  return jars.join(delimiter);
}

/** Quint 的命令行入口；用运行 ssot 的同一个 bun 执行，不另需 node。 */
export function quintCommand(): readonly string[] {
  const bin = join(DATA, "node_modules", ".bin", "quint");
  if (!existsSync(bin)) throw missing("Quint");
  return [process.execPath, bin];
}

export function likec4Command(): readonly string[] {
  const bin = join(DATA, "node_modules", ".bin", "likec4");
  if (!existsSync(bin)) throw missing("LikeC4");
  return [process.execPath, bin];
}

export async function loadLikeC4(): Promise<{ readonly LikeC4: typeof LikeC4 }> {
  let path: string;
  try {
    path = Bun.resolveSync("likec4", DATA);
  } catch {
    throw missing("LikeC4");
  }
  // 动态导入：LikeC4 装在 setup 的数据目录里，位置在运行时才确定，静态 import 解析不到。
  return (await import(path)) as { readonly LikeC4: typeof LikeC4 };
}

/** Both diagram renderers use the browser installed for LikeC4, never a separate download. */
export async function loadDiagramTools(): Promise<{ readonly ELK: typeof ELK; readonly chromium: typeof chromium }> {
  let elk: string;
  let playwright: string;
  try {
    elk = Bun.resolveSync("elkjs/lib/elk.bundled.js", DATA);
  } catch {
    throw missing("elkjs");
  }
  try {
    playwright = Bun.resolveSync("playwright-core", DATA);
  } catch {
    throw missing("LikeC4 的 Playwright");
  }
  // setup owns the runtime package location; static imports would resolve from the skill checkout instead.
  const layout: { readonly default: typeof ELK } = await import(elk);
  const browser: { readonly chromium: typeof chromium } = await import(playwright);
  return { ELK: layout.default, chromium: browser.chromium };
}
