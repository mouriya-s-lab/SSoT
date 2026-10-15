import { withCompiler } from './compiler.ts';
import { resolve } from './resolve.ts';
import { validateRelations } from './validate.ts';
import { readSource } from './source.ts';
import { checkMarkdown } from './markdown.ts';
import type { CheckReport, Result, ReviewItem, ReviewTopic } from './diagnostics.ts';
import type { RelationFacts, ResolvedDesign } from './model.ts';
import type { SourceSet } from './workspace-model.ts';
declare const validated: unique symbol;
export type ValidatedDesign = {
  readonly [validated]: true;
  readonly design: ResolvedDesign;
  readonly facts: RelationFacts;
  readonly report: CheckReport;
};
/** Only this pipeline constructs the validated brand, after all five stages succeed. */
export async function loadValidated(root: string): Promise<Result<ValidatedDesign>> {
  const input = readSource(root);
  if (input.kind === 'Rejected') return input;
  return checkSource(input.value);
}
export async function checkSource(source: SourceSet): Promise<Result<ValidatedDesign>> {
  const resolved = await withCompiler(source, (view) => resolve(source, view));
  if (resolved.kind === 'Rejected') return resolved;
  const relations = validateRelations(resolved.value);
  if (relations.kind === 'Rejected') return relations;
  const markdown = checkMarkdown(source, resolved.value, relations.value);
  if (markdown.kind === 'Rejected') return markdown;
  const topics: readonly ReviewTopic[] = [
    'grounds-and-rationale',
    'description-meaning',
    'connection-laws',
    'timing-and-concurrency',
    'lifecycle-responsibility',
    'requirements-and-scenario-coverage',
  ];
  const items: ReviewItem[] = [];
  for (const element of resolved.value.elements.filter((e) => e.kind !== 'Auxiliary'))
    for (const topic of topics)
      items.push({ topic, at: element.at, message: `Human semantic review required for ${element.id}` });
  for (const selection of relations.value.contracts)
    if (selection.kind === 'Role')
      items.push({
        topic: 'unbound-composition-choices',
        at: selection.connection.at,
        message: `Contract role ${selection.consumer.target} / ${selection.connection.target}; no provider is selected by this declaration`,
      });
  for (const context of relations.value.compositions)
    for (const selection of context.selections)
      if (selection.kind === 'Role')
        items.push({
          topic: 'unbound-composition-choices',
          at: selection.connection.at,
          message: `Unbound in ${context.composition}: ${selection.consumer.target} / ${selection.connection.target}`,
        });
  const report: CheckReport = {
    kind: 'AutomaticallyChecked',
    evidence: [
      { stage: 'source', files: source.files.length, facts: ['bounded-source-set', 'managed-files-current'] },
      {
        stage: 'typescript',
        projects: source.projects.length,
        facts: ['type-construction', 'project-direction'],
      },
      {
        stage: 'resolve',
        declarations: resolved.value.elements.length,
        facts: ['resolved-symbols', 'complete-descriptors', 'transitive-references'],
      },
      {
        stage: 'relations',
        elements: resolved.value.elements.length,
        facts: [
          'ownership-and-public-contracts',
          'declared-capabilities-and-legal-bindings',
          'declared-composition-cycles-scopes-and-finite-scenarios',
        ],
      },
      markdown.value,
    ],
    review: { kind: 'ManualReviewRequired', items },
    combination: relations.value.compositions.length
      ? {
          kind: 'WithCompositions',
          roles: relations.value.contracts.filter((s) => s.kind === 'Role'),
          contexts: relations.value.compositions,
        }
      : { kind: 'ContractOnly', roles: relations.value.contracts.filter((s) => s.kind === 'Role') },
  };
  return {
    kind: 'Accepted',
    value: { design: resolved.value, facts: relations.value, report } as ValidatedDesign,
  };
}
