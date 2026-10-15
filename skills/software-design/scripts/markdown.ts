import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Nodes, Root, Definition } from 'mdast';
import { reject, type Diagnostic, type Location, type MarkdownEvidence, type Result } from './diagnostics.ts';
import { lookup, type RelationFacts, type ResolvedDesign } from './model.ts';
import { operations, resolvedData, visibleElements } from './validate.ts';
import type { SourceSet } from './workspace-model.ts';
function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ('children' in node) for (const child of node.children) walk(child, visit);
}
function text(node: Nodes): string {
  if ('value' in node) return node.value;
  if ('children' in node) return node.children.map(text).join('');
  return '';
}
function identifier(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
/** CommonMark structure establishes syntax and visibility, never the meaning of a paragraph. */
export function checkMarkdown(
  source: SourceSet,
  design: ResolvedDesign,
  facts: RelationFacts,
): Result<MarkdownEvidence> {
  const errors: Diagnostic[] = [];
  const roots = new Map<string, Root>();
  const elements = new Map(design.elements.map((e) => [e.id, e]));
  for (const document of source.documents)
    roots.set(document.path, fromMarkdown(readFileSync(resolve(source.root, document.path), 'utf8')));
  for (const document of source.documents) {
    const root = roots.get(document.path)!;
    const allowed = visibleElements(design, facts, document.place);
    const at = (node: Nodes): Location => ({
      path: document.path,
      line: node.position?.start.line ?? 1,
      column: node.position?.start.column ?? 1,
    });
    const error = (node: Nodes, message: string, ambiguous = false): void => {
      errors.push({
        stage: 'markdown',
        code: ambiguous ? 'AmbiguousReference' : 'InvalidMarkdown',
        at: at(node),
        related: [],
        message,
      });
    };
    const definitions = new Map<string, Definition>();
    walk(root, (node) => {
      if (node.type === 'definition' && !definitions.has(identifier(node.identifier)))
        definitions.set(identifier(node.identifier), node);
    });
    const links: string[] = [];
    walk(root, (node) => {
      let url: string | undefined;
      if (node.type === 'link') url = node.url;
      if (node.type === 'linkReference') {
        const d = definitions.get(identifier(node.identifier));
        if (!d) error(node, `Missing link definition ${node.identifier}`);
        else url = d.url;
      }
      if (url !== undefined) {
        if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('#')) return;
        let path: string;
        try {
          path = decodeURIComponent(url.split('#')[0]!);
        } catch {
          error(node, 'Invalid link URL encoding');
          return;
        }
        const target = resolve(source.root, dirname(document.path), path);
        const rel = relative(source.root, target);
        if (rel.startsWith('..') || !existsSync(target) || lstatSync(target).isSymbolicLink())
          error(node, `Link target does not exist inside the design: ${url}`);
        else links.push(rel);
      }
      if (node.type !== 'inlineCode') return;
      const code = node.value;
      const explicit = code.includes('#');
      let selector = code;
      let member: string | undefined;
      const direct = lookup(allowed, selector);
      if (direct.kind === 'Found') return;
      const dot = code.lastIndexOf('.');
      if (dot >= 0) {
        const candidate = code.slice(0, dot);
        if (lookup(design.elements, candidate).kind !== 'Missing' || candidate.includes('#')) {
          selector = candidate;
          member = code.slice(dot + 1);
        }
      }
      const known = lookup(design.elements, selector);
      if (!explicit && known.kind === 'Missing') return;
      const found = lookup(allowed, selector);
      if (found.kind === 'Missing') {
        error(node, `Unknown or private design reference ${code}`);
        return;
      }
      if (found.kind === 'Ambiguous') {
        error(node, `Ambiguous design reference ${code}: ${found.candidates.join(', ')}`, true);
        return;
      }
      if (member !== undefined) {
        const e = elements.get(found.id)!;
        let names: readonly string[] = [];
        if (e.kind === 'Connection') names = operations(e).map((o) => o.name);
        if (e.kind === 'Data') {
          const data = resolvedData(e.expression, elements);
          if (data.kind === 'Outcome') names = data.variants.map((v) => v.name);
          else if (data.kind === 'Choice') names = data.cases.map((c) => c.name);
          else if (data.kind === 'Struct') names = data.fields.map((f) => f.name);
        }
        if (!names.includes(member)) error(node, `Unknown member ${code}`);
      }
    });
    if (root.children[0]?.type !== 'heading' || root.children[0].depth !== 1)
      error(root, 'Document must begin with an H1 title');
    const introduction = root.children.slice(1).find((n) => n.type !== 'html' && n.type !== 'definition');
    if (introduction?.type !== 'paragraph' || !text(introduction).trim())
      error(root, 'Document needs an introductory responsibility paragraph after the title');
    if (document.kind === 'Readme' && document.place.layer !== 'relations') {
      const order =
        document.place.layer === 'business' ? ['依据', '需求', '为什么', '语义'] : ['依据', '为什么', '语义'];
      let previous = -1;
      root.children.forEach((node, index) => {
        if (node.type !== 'heading' || node.depth !== 2) return;
        const name = text(node);
        const position = order.indexOf(name);
        if (position < 0 || position <= previous)
          error(node, `README sections must follow ${order.join('、')}`);
        previous = position;
        const content: Nodes[] = [];
        for (const sibling of root.children.slice(index + 1)) {
          if (sibling.type === 'heading' && sibling.depth <= 2) break;
          content.push(sibling);
        }
        if (
          !content.some(
            (n) => n.type !== 'html' && n.type !== 'definition' && n.type !== 'heading' && text(n).trim(),
          )
        )
          error(node, `Section ${name} needs actual content`);
      });
    }
    if (document.kind === 'Topic') {
      const readmePath = `${dirname(document.path)}/README.md`;
      const readme = roots.get(readmePath);
      let linked = false;
      if (readme) {
        const defs = new Map<string, Definition>();
        walk(readme, (n) => {
          if (n.type === 'definition' && !defs.has(identifier(n.identifier)))
            defs.set(identifier(n.identifier), n);
        });
        walk(readme, (n) => {
          const url =
            n.type === 'link'
              ? n.url
              : n.type === 'linkReference'
                ? defs.get(identifier(n.identifier))?.url
                : undefined;
          if (url && !/^[a-z][a-z\d+.-]*:/i.test(url)) {
            try {
              if (
                resolve(source.root, dirname(readmePath), decodeURIComponent(url.split('#')[0]!)) ===
                resolve(source.root, document.path)
              )
                linked = true;
            } catch {
              /* Invalid encoding is diagnosed while checking the README. */
            }
          }
        });
      }
      if (!linked) error(root, 'Topic needs a real link from its local README');
    }
  }
  if (errors.length) return reject(errors);
  return {
    kind: 'Accepted',
    value: {
      stage: 'markdown',
      documents: source.documents.length,
      facts: ['document-shape', 'links-and-symbol-references'],
    },
  };
}
