// `ssot setup`：安装 VDMJ、QuickCheck、LikeC4（含导出浏览器）、Quint（含 rust 求值器）、TypeScript；把 `ssot` 装进 BIN。
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, DATA, JARS, SETUP_GUIDE, quintCommand } from "./install";

const MAVEN = "https://repo1.maven.org/maven2/dk/au/ece/vdmj";
/** Vdm.java 用到 sealed interface、record 与 switch 模式匹配。 */
const JAVA_MAJOR = 21;
const ENTRY = join(import.meta.dir, "..", "ssot.ts");
/** 依赖清单只在 scripts/package.json；setup 按其中的名字取各自的最新发布。 */
const MANIFEST = join(import.meta.dir, "..", "package.json");

type Step = { readonly kind: "ok"; readonly note: string } | { readonly kind: "missing"; readonly note: string };

/** Vdm.java 由 java 运行、由 javac 编译成 class（见 compile/vdm.ts），所以需要带 javac 的 JDK。 */
function javaStep(): Step {
  const found = Bun.which("java");
  if (!found) return { kind: "missing", note: `PATH 上没有 java：需要 Java ${JAVA_MAJOR} 或更高版本的 JDK，安装方法见 ${SETUP_GUIDE}` };
  const run = Bun.spawnSync([found, "-version"]);
  const version = /version "(\d+)(?:\.(\d+))?/.exec(`${run.stderr.toString()}${run.stdout.toString()}`);
  const major = version ? Number(version[1] === "1" ? version[2] : version[1]) : 0;
  if (run.exitCode !== 0 || major < JAVA_MAJOR)
    return { kind: "missing", note: `PATH 上的 java（${found}）${version ? `是 Java ${major}` : "报不出版本"}：需要 Java ${JAVA_MAJOR} 或更高版本的 JDK，安装方法见 ${SETUP_GUIDE}` };
  const javac = Bun.which("javac");
  if (!javac) return { kind: "missing", note: `PATH 上有 java ${major}，但没有 javac：需要 JDK 而不只是 JRE，安装方法见 ${SETUP_GUIDE}` };
  return { kind: "ok", note: `java ${major}（${found}），javac（${javac}）` };
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取 ${url} 失败：HTTP ${response.status}`);
  return response;
}

async function installJars(): Promise<void> {
  for (const artifact of JARS) {
    const metadata = await (await fetchOk(`${MAVEN}/${artifact}/maven-metadata.xml`)).text();
    const latest = [...metadata.matchAll(/<version>([0-9.]+)<\/version>/g)].map((m) => m[1]!).sort(compareVersions).at(-1);
    if (!latest) throw new Error(`Maven Central 上没有 ${artifact} 的正式版本`);
    const jar = await fetchOk(`${MAVEN}/${artifact}/${latest}/${artifact}-${latest}.jar`);
    writeFileSync(join(DATA, `${artifact}.jar`), new Uint8Array(await jar.arrayBuffer()));
    console.log(`${artifact} ${latest} -> ${join(DATA, `${artifact}.jar`)}`);
  }
}

async function installPackages(): Promise<void> {
  const manifest = (await Bun.file(MANIFEST).json()) as { readonly dependencies: Readonly<Record<string, string>> };
  const names = Object.keys(manifest.dependencies);
  if (!existsSync(join(DATA, "package.json"))) writeFileSync(join(DATA, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
  const run = Bun.spawnSync([process.execPath, "add", ...names.map((n) => `${n}@latest`)], { cwd: DATA, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`bun add 以 ${run.exitCode} 退出`);
}

function installExportBrowser(): void {
  const cli = join(DATA, "node_modules", "playwright-core", "cli.js");
  const run = Bun.spawnSync([process.execPath, cli, "install", "chromium-headless-shell"], { stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`LikeC4 导出浏览器安装失败（${run.exitCode}）`);
}

/**
 * 模拟用 Quint 的 rust 后端。它的求值器在第一次使用时才从 GitHub 下载到 ~/.quint（或 QUINT_HOME）；
 * check 会并发启动多个 quint run，若由它们同时触发下载会争写同一个文件，所以在这里用一次最小的模拟先取下来。
 */
function installRustEvaluator(): void {
  const dir = mkdtempSync("/tmp/ssot-setup-");
  try {
    const spec = join(dir, "fetch.qnt");
    writeFileSync(spec, "module fetch {\n  var x: int\n  action init = x' = 0\n  action step = x' = x\n}\n");
    const run = Bun.spawnSync([...quintCommand(), "run", spec, "--main", "fetch", "--backend", "rust", "--max-samples", "1", "--max-steps", "1", "--out", join(dir, "out.json")], { stdout: "inherit", stderr: "inherit" });
    if (run.exitCode !== 0) throw new Error(`quint 的 rust 求值器未能取得：quint run 以 ${run.exitCode} 退出`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function installLauncher(): void {
  mkdirSync(BIN, { recursive: true });
  const launcher = join(BIN, "ssot");
  // 先前安装留下的 ssot 可能是符号链接（含指向已不存在文件的）；写文件会跟随链接，所以先移除这一项本身。
  rmSync(launcher, { force: true });
  const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
  writeFileSync(
    launcher,
    [
      "#!/bin/sh",
      "# 由 ssot setup 生成。",
      `command -v bun >/dev/null 2>&1 || { echo "ssot：PATH 上没有 bun，安装方法见 ${SETUP_GUIDE}" >&2; exit 127; }`,
      `exec bun ${quote(ENTRY)} "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(launcher, 0o755);
}

export async function setup(): Promise<number> {
  const java = javaStep();
  if (java.kind === "missing") {
    console.error(java.note);
    return 1;
  }
  console.log(java.note);
  mkdirSync(DATA, { recursive: true });
  await installJars();
  await installPackages();
  installExportBrowser();
  installRustEvaluator();
  installLauncher();
  const launcher = join(BIN, "ssot");
  const resolved = Bun.which("ssot");
  if (resolved !== launcher) {
    console.error(`ssot：PATH 上解析到 ${resolved ?? "（找不到）"}，应为 ${launcher}。`);
    console.error(`把 ${BIN} 放到 PATH 里其他同名命令之前，例如在 shell 启动文件里加入：export PATH="${BIN}:$PATH"`);
    return 1;
  }
  console.log(`ssot 已在 PATH 上：${launcher}`);
  return 0;
}
