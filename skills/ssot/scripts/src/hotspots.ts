// `ssot hotspots <路径> [--top N] [--since <rev-or-date>]`：
// 事后从 git 历史做问题热点溯源：
//   1. 哪个文件、哪个目录/模块的代码改得最多（提交次数、修复提交次数、行改动量 churn）；
//   2. 哪些文件总在同一提交（尤其是修复提交）里协同改动（暴露跨文件/跨边界耦合热点）；
//   3. 从热点文件反推到关键 commit（修复/回滚/高频改动提交及其正文摘要）；
//   4. 从 commit 反推到关联的 issue/PR（汇总每个 #issue 触及的热点 commit 与热点文件，并在 GitHub 远端可用时附上标题与摘要）。
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export interface FileHotspot {
  readonly file: string;
  readonly commits: number;
  readonly fixCommits: number;
  readonly added: number;
  readonly deleted: number;
  readonly churn: number;
  readonly score: number;
  readonly issueRefs: readonly number[];
  readonly recentCommits: readonly string[];
}

export interface ModuleHotspot {
  readonly module: string;
  readonly files: number;
  readonly commits: number;
  readonly fixCommits: number;
  readonly churn: number;
  readonly score: number;
  readonly issueRefs: readonly number[];
}

export interface CoChangeHotspot {
  readonly fileA: string;
  readonly fileB: string;
  readonly sharedCommits: number;
  readonly sharedFixCommits: number;
  readonly commits: readonly string[];
}

export interface CommitHotspot {
  readonly hash: string;
  readonly date: string;
  readonly subject: string;
  readonly bodyExcerpt: string;
  readonly isFix: boolean;
  readonly issueRefs: readonly number[];
  readonly hotspotFiles: readonly {
    readonly file: string;
    readonly added: number;
    readonly deleted: number;
  }[];
}

export interface IssueDetail {
  readonly title: string;
  readonly state: string;
  readonly url: string;
  readonly bodyExcerpt: string;
}

export interface IssueHotspot {
  readonly number: number;
  readonly commits: readonly string[];
  readonly hotspotFiles: readonly string[];
  readonly subjects: readonly string[];
  readonly detail: IssueDetail | null;
}

export type HotspotReport =
  | {
      readonly kind: "ok";
      readonly repo: string;
      readonly scope: string;
      readonly totalCommits: number;
      readonly totalFixCommits: number;
      readonly files: readonly FileHotspot[];
      readonly modules: readonly ModuleHotspot[];
      readonly coChanges: readonly CoChangeHotspot[];
      readonly commits: readonly CommitHotspot[];
      readonly issues: readonly IssueHotspot[];
    }
  | {
      readonly kind: "failed";
      readonly message: string;
    };

interface ParsedCommit {
  readonly hash: string;
  readonly date: string;
  readonly subject: string;
  readonly body: string;
  readonly isFix: boolean;
  readonly issueRefs: readonly number[];
  readonly files: readonly { readonly file: string; readonly added: number; readonly deleted: number }[];
}

const IGNORED_NAMES = new Set([
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
  "Cargo.lock",
  "go.sum",
  "poetry.lock",
  "uv.lock",
]);

const FIX_PATTERN =
  /\b(fix(?:e[sd])?|bug(?:fix)?|revert|hotfix|race|deadlock|crash|panic|hang|leak|corrupt(?:ion)?|desync|idempoten\w*|re-?entran\w*|retry|timeout|out-of-order|stale|duplicate|inconsisten\w*|rollback|resolve[sd]?|close[sd]?)\b|修复|故障|事故|崩溃|死锁|并发|竞态|重入|乱序|晚到|幂等|失步|丢数据|重复|回滚|泄漏|超时/i;

function isIgnoredFile(path: string): boolean {
  if (IGNORED_NAMES.has(basename(path))) return true;
  const parts = path.split("/");
  return parts.includes(".gen") || parts.includes("node_modules") || parts.includes("dist");
}

function extractIssueRefs(text: string): readonly number[] {
  const found = new Set<number>();
  const patterns = [
    /(?:^|[\s([,:;])#(\d+)\b/g,
    /\b(?:GH-|issue\s+#?|fixes\s+#?|closes\s+#?|resolves\s+#?)(\d+)\b/gi,
    /github\.com\/[^/\s]+\/[^/\s]+\/(?:issues|pull)\/(\d+)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > 0) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function summarizeBody(body: string): string {
  const cleaned = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^(Co-Authored-By|Signed-off-by):/i.test(l))
    .join(" ");
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

function moduleOf(file: string, scopeRel: string): string {
  const sub = scopeRel.length > 0 ? relative(scopeRel, file) : file;
  const parts = sub.split("/");
  const prefix = scopeRel.length > 0 ? `${scopeRel}/` : "";
  if (parts.length <= 1) return scopeRel.length > 0 ? scopeRel : ".";
  if (parts.length === 2) return `${prefix}${parts[0]!}`;
  return `${prefix}${parts[0]!}/${parts[1]!}`;
}

function git(cwd: string, args: readonly string[]): { readonly ok: boolean; readonly out: string } {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.exitCode === 0 ? r.stdout.toString() : r.stderr.toString() };
}

function parseGitLog(raw: string, toplevel: string): readonly ParsedCommit[] {
  const out: ParsedCommit[] = [];
  for (const record of raw.split("\x1e")) {
    const trimmed = record.trim();
    if (trimmed.length === 0) continue;
    const headerEnd = trimmed.indexOf("\x1d");
    if (headerEnd < 0) continue;
    const header = trimmed.slice(0, headerEnd);
    const numstatBlock = trimmed.slice(headerEnd + 1).trim();
    const [fullHash = "", date = "", subject = "", body = ""] = header.split("\x1f");
    if (fullHash.length === 0) continue;
    const hash = fullHash.slice(0, 7);
    const combinedText = `${subject}\n${body}`;
    const issueRefs = extractIssueRefs(combinedText);
    const isFix = FIX_PATTERN.test(combinedText);
    const files: { readonly file: string; readonly added: number; readonly deleted: number }[] = [];
    for (const line of numstatBlock.split("\n")) {
      const l = line.trim();
      if (l.length === 0) continue;
      const parts = l.split("\t");
      if (parts.length < 3) continue;
      const [addStr = "", delStr = "", ...pathParts] = parts;
      const rawPath = pathParts.join("\t").replace(/\{([^{}]*?) => ([^{}]*?)\}/g, "$2").replace(/.* => /, "");
      if (addStr === "-" || delStr === "-" || isIgnoredFile(rawPath) || !existsSync(join(toplevel, rawPath))) continue;
      const added = Number(addStr);
      const deleted = Number(delStr);
      if (!Number.isFinite(added) || !Number.isFinite(deleted)) continue;
      files.push({ file: rawPath, added, deleted });
    }
    if (files.length === 0) continue;
    out.push({ hash, date, subject: subject.trim(), body: body.trim(), isFix, issueRefs, files });
  }
  return out;
}

function hasGitHubRemote(toplevel: string): boolean {
  if (process.env.SSOT_GH_DISABLED === "1") return false;
  const r = git(toplevel, ["remote", "get-url", "origin"]);
  return r.ok && /github\.com[:/]/i.test(r.out);
}

function fetchIssueDetail(toplevel: string, issueNumber: number): IssueDetail | null {
  const r = Bun.spawnSync(
    ["gh", "issue", "view", String(issueNumber), "--json", "title,state,url,body"],
    { cwd: toplevel, stdout: "pipe", stderr: "pipe", timeout: 3000 },
  );
  if (r.exitCode !== 0) {
    const pr = Bun.spawnSync(
      ["gh", "pr", "view", String(issueNumber), "--json", "title,state,url,body"],
      { cwd: toplevel, stdout: "pipe", stderr: "pipe", timeout: 3000 },
    );
    if (pr.exitCode !== 0) return null;
    try {
      const parsed = JSON.parse(pr.stdout.toString()) as { title?: unknown; state?: unknown; url?: unknown; body?: unknown };
      return {
        title: typeof parsed.title === "string" ? parsed.title : "",
        state: typeof parsed.state === "string" ? parsed.state : "",
        url: typeof parsed.url === "string" ? parsed.url : "",
        bodyExcerpt: typeof parsed.body === "string" ? summarizeBody(parsed.body) : "",
      };
    } catch {
      return null;
    }
  }
  try {
    const parsed = JSON.parse(r.stdout.toString()) as { title?: unknown; state?: unknown; url?: unknown; body?: unknown };
    return {
      title: typeof parsed.title === "string" ? parsed.title : "",
      state: typeof parsed.state === "string" ? parsed.state : "",
      url: typeof parsed.url === "string" ? parsed.url : "",
      bodyExcerpt: typeof parsed.body === "string" ? summarizeBody(parsed.body) : "",
    };
  } catch {
    return null;
  }
}

export interface HotspotOptions {
  readonly top: number;
  readonly since: string | null;
}

export function analyzeHotspots(targetPath: string, options: HotspotOptions): HotspotReport {
  const abs = resolve(targetPath);
  if (!existsSync(abs)) return { kind: "failed", message: `路径不存在：${targetPath}` };
  const real = realpathSync(abs);
  const cwd = statSync(real).isDirectory() ? real : dirname(real);
  const topRes = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!topRes.ok) return { kind: "failed", message: `路径不在 git 仓库内：${topRes.out.trim()}` };
  const toplevel = realpathSync(topRes.out.trim());
  const rel = relative(toplevel, real);
  const logArgs: string[] = [
    "log",
    "--no-merges",
    "--numstat",
    "--date=short",
    "--format=%x1e%H%x1f%ad%x1f%s%x1f%b%x1d",
  ];
  if (options.since !== null) logArgs.push(`--since=${options.since}`);
  if (rel.length > 0) logArgs.push("--", rel);
  const logRes = git(toplevel, logArgs);
  if (!logRes.ok) return { kind: "failed", message: `读取 git 历史失败：${logRes.out.trim()}` };

  const commits = parseGitLog(logRes.out, toplevel);
  const fileAcc = new Map<
    string,
    {
      commits: number;
      fixCommits: number;
      added: number;
      deleted: number;
      issues: Set<number>;
      recent: string[];
    }
  >();
  const moduleAcc = new Map<
    string,
    {
      files: Set<string>;
      commits: Set<string>;
      fixCommits: Set<string>;
      churn: number;
      issues: Set<number>;
    }
  >();
  const pairAcc = new Map<string, { fileA: string; fileB: string; sharedCommits: number; sharedFixCommits: number; commits: string[] }>();

  for (const c of commits) {
    for (const f of c.files) {
      const cur = fileAcc.get(f.file) ?? { commits: 0, fixCommits: 0, added: 0, deleted: 0, issues: new Set<number>(), recent: [] };
      cur.commits += 1;
      if (c.isFix) cur.fixCommits += 1;
      cur.added += f.added;
      cur.deleted += f.deleted;
      for (const id of c.issueRefs) cur.issues.add(id);
      if (cur.recent.length < 8) cur.recent.push(c.hash);
      fileAcc.set(f.file, cur);

      const mod = moduleOf(f.file, rel);
      const mCur = moduleAcc.get(mod) ?? { files: new Set<string>(), commits: new Set<string>(), fixCommits: new Set<string>(), churn: 0, issues: new Set<number>() };
      mCur.files.add(f.file);
      mCur.commits.add(c.hash);
      if (c.isFix) mCur.fixCommits.add(c.hash);
      mCur.churn += f.added + f.deleted;
      for (const id of c.issueRefs) mCur.issues.add(id);
      moduleAcc.set(mod, mCur);
    }

    // 单次提交涉及文件数在合理范围内（<= 20）时统计协同改动对，排除全库格式化噪音。
    if (c.files.length >= 2 && c.files.length <= 20) {
      const sorted = [...new Set(c.files.map((f) => f.file))].sort();
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const fileA = sorted[i]!;
          const fileB = sorted[j]!;
          const key = `${fileA}\0${fileB}`;
          const p = pairAcc.get(key) ?? { fileA, fileB, sharedCommits: 0, sharedFixCommits: 0, commits: [] };
          p.sharedCommits += 1;
          if (c.isFix) p.sharedFixCommits += 1;
          if (p.commits.length < 6) p.commits.push(c.hash);
          pairAcc.set(key, p);
        }
      }
    }
  }

  const allFiles: FileHotspot[] = [...fileAcc.entries()]
    .map(([file, s]) => {
      const churn = s.added + s.deleted;
      const score = s.fixCommits * 3 + s.commits;
      return {
        file,
        commits: s.commits,
        fixCommits: s.fixCommits,
        added: s.added,
        deleted: s.deleted,
        churn,
        score,
        issueRefs: [...s.issues].sort((a, b) => a - b),
        recentCommits: s.recent,
      };
    })
    .sort((a, b) => b.score - a.score || b.commits - a.commits || b.churn - a.churn || a.file.localeCompare(b.file));

  const topFiles = allFiles.slice(0, options.top);
  const topFileSet = new Set(topFiles.map((f) => f.file));

  const modules: ModuleHotspot[] = [...moduleAcc.entries()]
    .map(([mod, m]) => {
      const score = m.fixCommits.size * 3 + m.commits.size;
      return {
        module: mod,
        files: m.files.size,
        commits: m.commits.size,
        fixCommits: m.fixCommits.size,
        churn: m.churn,
        score,
        issueRefs: [...m.issues].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => b.score - a.score || b.commits - a.commits || b.churn - a.churn || a.module.localeCompare(b.module))
    .slice(0, options.top);

  const coChanges: CoChangeHotspot[] = [...pairAcc.values()]
    .filter((p) => p.sharedCommits >= 2)
    .sort(
      (a, b) =>
        b.sharedFixCommits * 3 + b.sharedCommits - (a.sharedFixCommits * 3 + a.sharedCommits) ||
        b.sharedCommits - a.sharedCommits ||
        a.fileA.localeCompare(b.fileA) ||
        a.fileB.localeCompare(b.fileB),
    )
    .slice(0, options.top);

  // 从热点文件反推到关键 commit：优先取触及热点文件、属修复或带 issue 引用的提交。
  const hotspotCommits: CommitHotspot[] = commits
    .map((c) => {
      const touched = c.files.filter((f) => topFileSet.has(f.file));
      return { commit: c, touched };
    })
    .filter((x) => x.touched.length > 0)
    .sort((a, b) => {
      const weight = (x: typeof a): number =>
        (x.commit.isFix ? 6 : 0) + x.commit.issueRefs.length * 4 + x.touched.length * 2;
      return weight(b) - weight(a);
    })
    .slice(0, options.top)
    .map(({ commit: c, touched }) => ({
      hash: c.hash,
      date: c.date,
      subject: c.subject,
      bodyExcerpt: summarizeBody(c.body),
      isFix: c.isFix,
      issueRefs: c.issueRefs,
      hotspotFiles: touched,
    }));

  // 从 commit 反推到关联的 issue/PR。
  const issueAcc = new Map<number, { commits: string[]; files: Set<string>; subjects: string[] }>();
  for (const c of commits) {
    for (const num of c.issueRefs) {
      const cur = issueAcc.get(num) ?? { commits: [], files: new Set<string>(), subjects: [] };
      cur.commits.push(c.hash);
      for (const f of c.files) {
        if (topFileSet.has(f.file)) cur.files.add(f.file);
      }
      if (cur.subjects.length < 5) cur.subjects.push(c.subject);
      issueAcc.set(num, cur);
    }
  }

  const canFetchGh = hasGitHubRemote(toplevel);
  const issues: IssueHotspot[] = [...issueAcc.entries()]
    .sort((a, b) => b[1].files.size - a[1].files.size || b[1].commits.length - a[1].commits.length || b[0] - a[0])
    .slice(0, options.top)
    .map(([num, data], idx) => ({
      number: num,
      commits: data.commits,
      hotspotFiles: [...data.files].sort(),
      subjects: data.subjects,
      detail: canFetchGh && idx < 8 ? fetchIssueDetail(toplevel, num) : null,
    }));

  return {
    kind: "ok",
    repo: toplevel,
    scope: rel.length > 0 ? rel : ".",
    totalCommits: commits.length,
    totalFixCommits: commits.filter((c) => c.isFix).length,
    files: topFiles,
    modules,
    coChanges,
    commits: hotspotCommits,
    issues,
  };
}

export function hotspotsCommand(targetPath: string, rest: readonly string[]): number {
  let top = 15;
  let since: string | null = null;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    const val = rest[i + 1];
    if (flag === "--top" && val !== undefined) {
      const parsed = Number(val);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.log(JSON.stringify({ kind: "failed", message: `--top 需要正整数：${val}` }, null, 2));
        return 2;
      }
      top = parsed;
    } else if (flag === "--since" && val !== undefined) {
      since = val;
    } else {
      console.log(JSON.stringify({ kind: "failed", message: `未知的 hotspots 选项：${flag ?? ""}` }, null, 2));
      return 2;
    }
  }
  const report = analyzeHotspots(targetPath, { top, since });
  console.log(JSON.stringify(report, null, 2));
  return report.kind === "ok" ? 0 : 1;
}
