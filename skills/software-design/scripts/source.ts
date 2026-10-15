import { reject, type Result } from './diagnostics.ts';
import { inspectLayout, pendingGenerated } from './workspace-fs.ts';
import type { SourceSet } from './workspace-model.ts';

/** Establish bounded ordinary inputs and current generated files before opening the compiler. */
export function readSource(root: string): Result<SourceSet> {
  const layout = inspectLayout(root);
  if (layout.kind === 'Rejected') return layout;
  const pending = pendingGenerated(layout.value);
  if (pending.kind === 'Rejected') return pending;
  if (pending.value.length)
    return reject(
      pending.value.map((file) => ({
        stage: 'source' as const,
        code: 'OutdatedGeneratedFile' as const,
        at: { path: file.path, line: 1, column: 1 },
        related: [],
        message:
          'Managed file differs from the current generator contract; inspect upgrade --check, then run upgrade',
      })),
    );
  return { kind: 'Accepted', value: layout.value.source };
}
