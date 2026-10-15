import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Result } from './diagnostics.ts';
import { generatedFiles } from './configuration.ts';
import {
  APPENDICES,
  NAME,
  failure,
  inspectLayout,
  message,
  pendingGenerated,
  template,
} from './workspace-fs.ts';
import type { UpgradePlan, WorkspaceChange } from './workspace-model.ts';

type Write = { readonly path: string; readonly content: string; readonly mode: 'Create' | 'Replace' };

/** Safety is prechecked by each caller; IO failures report only confirmed writes, not a transaction. */
function writeFiles(root: string, files: readonly Write[]): Result<WorkspaceChange> {
  const written: string[] = [];
  for (const file of files) {
    try {
      mkdirSync(dirname(join(root, file.path)), { recursive: true });
      writeFileSync(join(root, file.path), file.content, { flag: file.mode === 'Create' ? 'wx' : 'w' });
      written.push(file.path);
    } catch (cause) {
      return failure(
        root,
        file.path,
        'WriteFailed',
        `Unable to write workspace file: ${message(cause)}`,
        written,
      );
    }
  }
  return { kind: 'Accepted', value: { kind: 'Generated', root, written } };
}

export function initialize(repo: string): Result<WorkspaceChange> {
  const base = resolve(repo);
  const root = join(base, 'design');
  try {
    const parent = lstatSync(base, { throwIfNoEntry: false });
    if (parent?.isSymbolicLink())
      return failure(root, '..', 'UnsafeInput', 'Repository root must not be a symbolic link');
    if (!parent?.isDirectory())
      return failure(
        root,
        '..',
        'InvalidLayout',
        'Repository root must already exist as an ordinary directory',
      );
    const existing = lstatSync(root, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink())
      return failure(root, '.', 'UnsafeInput', 'Design root must not be a symbolic link');
    if (existing && (!existing.isDirectory() || readdirSync(root).length))
      return failure(root, '.', 'InvalidLayout', 'Refusing to overwrite an existing nonempty design root');
  } catch (cause) {
    return failure(root, '.', 'UnsafeInput', `Unable to inspect repository root: ${message(cause)}`);
  }
  const dsl = template();
  if (dsl.kind === 'Rejected') return dsl;
  const navigation =
    '# 设计\n\n- [架构](architecture/README.md)\n- [关系](relations/README.md)\n- [示例](appendix/examples/)\n- [证据](appendix/evidence/)\n- [实现参考](appendix/reference/)\n\n业务单元为可选材料，可用 unit 命令创建。\n\n运行时图：加载 `skill://software-design-graph`，使用 view、search、neighbors 或 path；图不保存到设计目录。\n';
  return writeFiles(root, [
    ...generatedFiles(false, dsl.value).map((file) => ({ ...file, mode: 'Create' as const })),
    { path: 'README.md', content: navigation, mode: 'Create' },
    { path: 'architecture/README.md', content: '# 架构\n', mode: 'Create' },
    { path: 'relations/README.md', content: '# 关系\n', mode: 'Create' },
    ...APPENDICES.map((name) => ({
      path: `appendix/${name}/.gitkeep`,
      content: '',
      mode: 'Create' as const,
    })),
  ]);
}

export function addModule(input: string, name: string): Result<WorkspaceChange> {
  const root = resolve(input);
  const parts = name.split('/');
  if (!parts.every((part) => NAME.test(part)))
    return failure(
      root,
      'architecture',
      'InvalidLayout',
      'Module path segments must start with a lowercase letter and contain only lowercase letters, digits and hyphens',
    );
  const layout = inspectLayout(root);
  if (layout.kind === 'Rejected') return layout;
  const parent = ['architecture', ...parts.slice(0, -1)].join('/');
  if (!layout.value.source.directories.some((directory) => directory.path === parent))
    return failure(
      root,
      parent,
      'InvalidLayout',
      'The parent module must already exist and contain README.md',
    );
  const path = `architecture/${name}`;
  try {
    if (lstatSync(join(root, path), { throwIfNoEntry: false }))
      return failure(root, path, 'InvalidLayout', 'Module path already exists; refusing to overwrite');
  } catch (cause) {
    return failure(root, path, 'UnsafeInput', `Unable to inspect new module path: ${message(cause)}`);
  }
  return writeFiles(root, [
    { path: `${path}/README.md`, content: `# ${parts[parts.length - 1]}\n`, mode: 'Create' },
  ]);
}

export function addUnit(input: string, name: string): Result<WorkspaceChange> {
  const root = resolve(input);
  if (!NAME.test(name))
    return failure(
      root,
      'business',
      'InvalidLayout',
      'Unit name must start with a lowercase letter and contain only lowercase letters, digits and hyphens',
    );
  const layout = inspectLayout(root);
  if (layout.kind === 'Rejected') return layout;
  const path = `business/${name}`;
  try {
    if (lstatSync(join(root, path), { throwIfNoEntry: false }))
      return failure(root, path, 'InvalidLayout', 'Unit path already exists; refusing to overwrite');
  } catch (cause) {
    return failure(root, path, 'UnsafeInput', `Unable to inspect new unit path: ${message(cause)}`);
  }
  const files: Write[] = [{ path: `${path}/README.md`, content: `# ${name}\n`, mode: 'Create' }];
  if (!layout.value.business) {
    // The first unit changes only the generated project dependency graph and navigation.
    for (const file of generatedFiles(true, '')) {
      if (
        file.kind === 'Configuration' &&
        ['tsconfig.json', 'relations/tsconfig.json', 'business/tsconfig.json'].includes(file.path)
      )
        files.push({ ...file, mode: file.path.startsWith('business/') ? 'Create' : 'Replace' });
    }
    try {
      const text = readFileSync(join(root, 'README.md'), 'utf8');
      files.push({
        path: 'README.md',
        content: `${text}${text.endsWith('\n') ? '\n' : '\n\n'}- [业务单元](business/)\n`,
        mode: 'Replace',
      });
    } catch (cause) {
      return failure(root, 'README.md', 'UnsafeInput', `Unable to read design navigation: ${message(cause)}`);
    }
  }
  return writeFiles(root, files);
}

export function planUpgrade(root: string): Result<UpgradePlan> {
  const layout = inspectLayout(root);
  if (layout.kind === 'Rejected') return layout;
  const pending = pendingGenerated(layout.value);
  if (pending.kind === 'Rejected') return pending;
  return {
    kind: 'Accepted',
    value: pending.value.length ? { kind: 'UpgradeAvailable', writes: pending.value } : { kind: 'UpToDate' },
  };
}

export function upgrade(input: string): Result<WorkspaceChange> {
  const root = resolve(input);
  const plan = planUpgrade(root);
  if (plan.kind === 'Rejected') return plan;
  return writeFiles(
    root,
    plan.value.kind === 'UpToDate' ? [] : plan.value.writes.map((file) => ({ ...file, mode: 'Replace' })),
  );
}
