// 节点图标：让人一眼看出每个框是什么。图标取自 LikeC4 带的图标库（@likec4/icons），与模型里 `icon tech:go` 的写法同名。
import { DATA, NotInstalled, SETUP_GUIDE } from "../install";
import { assertNever } from "../diag";
import type { C4DiagramNode, C4NodeKind } from "./c4";

/**
 * 一个节点用哪个图标、为什么。declared：模型里写了 icon；technology：从 technology 文字认出的技术；kind：只知道
 * 种类。url 是图标库的 `<集>:<名>`（tech:go、bootstrap:hdd）或图片的 http(s) 地址；label 写进图例。
 */
export interface NodeIcon {
  readonly source: "declared" | "technology" | "kind";
  readonly url: string;
  readonly label: string;
}

/** 按词匹配：前后不能紧挨着字母或数字，go 不会匹配 google，java 不会匹配 javascript。 */
const words = (alternatives: string): RegExp => new RegExp(`(?<![a-z0-9])(?:${alternatives})(?![a-z0-9])`, "i");

/** 从 technology 文字认技术，取文字里最先出现的那个。 */
const TECHNOLOGIES: readonly { readonly pattern: RegExp; readonly url: string; readonly label: string }[] = [
  ...([
    ["go|golang", "tech:go", "Go"], ["rust", "tech:rust", "Rust"], ["typescript", "tech:typescript-icon", "TypeScript"],
    ["javascript", "tech:javascript", "JavaScript"], ["node\\.?js", "tech:nodejs-icon", "Node.js"], ["bun", "tech:bun", "Bun"],
    ["deno", "tech:deno", "Deno"], ["python", "tech:python", "Python"], ["java", "tech:java", "Java"], ["kotlin", "tech:kotlin-icon", "Kotlin"],
    ["swift", "tech:swift", "Swift"], ["react", "tech:react", "React"], ["vue", "tech:vue", "Vue"],
    ["postgres(?:ql)?", "tech:postgresql", "PostgreSQL"], ["mysql", "tech:mysql-icon", "MySQL"], ["sqlite", "tech:sqlite", "SQLite"],
    ["redis", "tech:redis", "Redis"], ["mongodb", "tech:mongodb-icon", "MongoDB"], ["kafka", "tech:kafka-icon", "Kafka"],
    ["rabbitmq", "tech:rabbitmq-icon", "RabbitMQ"], ["elasticsearch", "tech:elasticsearch", "Elasticsearch"], ["nginx", "tech:nginx", "nginx"],
    ["docker|compose", "tech:docker-icon", "Docker"], ["kubernetes|k8s", "tech:kubernetes", "Kubernetes"],
    ["github", "tech:github-icon", "GitHub"], ["gitlab", "tech:gitlab-icon", "GitLab"], ["git", "tech:git-icon", "Git"],
    ["cloudflare", "tech:cloudflare-icon", "Cloudflare"], ["aws", "tech:aws", "AWS"], ["terraform|opentofu", "tech:terraform-icon", "Terraform"],
    ["ansible", "tech:ansible", "Ansible"], ["grafana", "tech:grafana", "Grafana"], ["prometheus", "tech:prometheus", "Prometheus"],
    ["graphql", "tech:graphql", "GraphQL"], ["telegram", "tech:telegram", "Telegram"], ["slack", "tech:slack-icon", "Slack"],
    ["openai", "tech:openai-icon", "OpenAI"], ["anthropic", "tech:anthropic-icon", "Anthropic"], ["claude", "tech:claude-icon", "Claude"],
    ["macos|ios|apple", "tech:apple", "Apple"], ["linux", "tech:linux-tux", "Linux"],
  ] as const).map(([alternatives, url, label]) => ({ pattern: words(alternatives), url, label })),
  // 不是品牌但一看就懂的东西。
  ...([
    ["volume|卷|磁盘|disk", "bootstrap:hdd", "Volume"], ["database|数据库", "bootstrap:database", "Database"],
    ["queue|队列", "bootstrap:inbox", "Queue"], ["cli|命令行|terminal", "bootstrap:terminal", "CLI"],
    ["browser|浏览器|spa", "bootstrap:window", "Browser"], ["daemon|守护进程", "bootstrap:gear", "Daemon"],
  ] as const).map(([alternatives, url, label]) => ({ pattern: words(alternatives), url, label })),
];

/** 部署节点的种类（host、stack…）对应的图标。 */
const DEPLOYMENT_KINDS: readonly { readonly pattern: RegExp; readonly url: string }[] = [
  { pattern: words("host|server|machine|vm|node|主机|服务器"), url: "bootstrap:hdd-rack" },
  { pattern: words("stack|compose"), url: "bootstrap:stack" },
  { pattern: words("cluster|k8s|kubernetes"), url: "tech:kubernetes" },
  { pattern: words("cloud|region|zone|saas|云"), url: "bootstrap:cloud" },
  { pattern: words("network|net|vpc|lan|网络"), url: "bootstrap:diagram-3" },
];

const KIND_ICONS: Readonly<Record<Exclude<C4NodeKind, "deploymentNode">, string>> = {
  person: "bootstrap:person-fill",
  system: "bootstrap:boxes",
  external: "bootstrap:globe",
  container: "bootstrap:box-seam",
  store: "bootstrap:database",
  component: "bootstrap:puzzle",
};

/** notation：种类的 C4 记法（图例里写它）。 */
export function nodeIcon(node: C4DiagramNode, notation: string): NodeIcon {
  if (node.icon !== null && node.icon !== "none") return { source: "declared", url: node.icon, label: node.icon.replace(/^[a-z]+:/, "") };
  switch (node.kind) {
    case "deploymentNode": {
      const kind = node.technology ?? "";
      return { source: "kind", url: DEPLOYMENT_KINDS.find((k) => k.pattern.test(kind))?.url ?? "bootstrap:hdd-network", label: `${notation}: ${kind}` };
    }
    case "person": case "system": case "external": case "container": case "store": case "component": {
      const text = node.technology ?? "";
      const found = TECHNOLOGIES
        .map((t) => ({ t, at: text.search(t.pattern) }))
        .filter(({ at }) => at >= 0)
        .sort((a, b) => a.at - b.at)[0];
      return found ? { source: "technology", url: found.t.url, label: found.t.label } : { source: "kind", url: KIND_ICONS[node.kind], label: notation };
    }
    default: return assertNever(node.kind);
  }
}

interface ReactRuntime { createElement(type: unknown, props: Readonly<Record<string, unknown>>): unknown }
interface ReactServer { renderToStaticMarkup(element: unknown): string }
const ICON_SETS = ["tech", "bootstrap", "aws", "azure", "gcp"] as const;

/**
 * 把图标画成放在 (0,0)、size×size 的 SVG 片段，按 url 去重。图标库里的图标是 React 组件，在这里渲染成静态标记；
 * 图标里的 id 加上序号前缀，多个图标放进同一张图时渐变、裁剪不会互相串。
 */
export async function loadIcons(urls: readonly string[], size: number): Promise<ReadonlyMap<string, string>> {
  const resolve = (specifier: string): string => {
    try {
      return Bun.resolveSync(specifier, DATA);
    } catch {
      throw new NotInstalled(`${specifier} 尚未安装到 ${DATA}：先运行 ssot setup，见 ${SETUP_GUIDE}`);
    }
  };
  const unique = [...new Set(urls)];
  if (unique.length === 0) return new Map();
  const react = (await import(resolve("react"))) as ReactRuntime;
  const server = (await import(resolve("react-dom/server"))) as ReactServer;
  const out = new Map<string, string>();
  for (const [n, url] of unique.entries()) {
    if (/^https?:\/\//.test(url)) {
      out.set(url, `<image href="${url.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`);
      continue;
    }
    const match = /^([a-z]+):([a-z0-9-]+)$/.exec(url);
    const set = ICON_SETS.find((s) => s === match?.[1]);
    if (!match || !set) throw new Error(`图标 ${url} 不是图标库（${ICON_SETS.join("、")}）里的 <集>:<名>，也不是 http(s) 图片地址`);
    resolve("@likec4/icons");
    let path: string;
    try {
      path = Bun.resolveSync(`@likec4/icons/${set}/${match[2]}`, DATA);
    } catch {
      throw new Error(`图标库的 ${set} 集里没有 ${match[2]}（图标 ${url}）`);
    }
    const module = (await import(path)) as { readonly default: unknown };
    const markup = server.renderToStaticMarkup(react.createElement(module.default, { width: size, height: size }));
    out.set(url, markup.replace(/id="([^"]+)"/g, `id="i${n}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#i${n}-$1)`).replace(/href="#([^"]+)"/g, `href="#i${n}-$1"`));
  }
  return out;
}
