import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Diagnostic, Result, StageCodes } from './diagnostics.ts';
import { reject } from './diagnostics.ts';
import { generatedFiles } from './configuration.ts';
import type { Place } from './model.ts';
import type { GeneratedFile, SourceSet } from './workspace-model.ts';

export const NAME = /^[a-z][a-z0-9-]*$/;
const FILE_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*$/;
export const APPENDICES = ['examples', 'evidence', 'reference'] as const;
export const slash = (path: string): string => path.split(sep).join('/');
export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
export function failure(
  root: string,
  path: string,
  code: StageCodes['source'],
  text: string,
  written?: readonly string[],
): ReturnType<typeof reject> {
  return reject([
    {
      stage: 'source',
      code,
      at: { path: slash(relative(root, resolve(root, path))) || '.', line: 1, column: 1 },
      related: [],
      message: text,
      ...(written === undefined ? {} : { details: { kind: 'Writes' as const, written } }),
    },
  ]);
}
export type Layout = { readonly source: SourceSet; readonly business: boolean };

/** Fresh lstat traversal. Never follows a design-owned link, even for an appendix. */
export function inspectLayout(input: string): Result<Layout> {
  const root = resolve(input);
  const errors: Diagnostic[] = [];
  const files: string[] = [];
  const types: string[] = [];
  const documents: SourceSet['documents'][number][] = [];
  const directories: SourceSet['directories'][number][] = [];
  const error = (path: string, code: StageCodes['source'], text: string): void => {
    errors.push({
      stage: 'source',
      code,
      at: { path: path || '.', line: 1, column: 1 },
      related: [],
      message: text,
    });
  };
  let current = '';
  try {
    const stat = (path: string): ReturnType<typeof lstatSync> | undefined => {
      current = path;
      const value = lstatSync(join(root, path), { throwIfNoEntry: false });
      if (value?.isSymbolicLink() || (value && !value.isDirectory() && !value.isFile())) {
        error(
          path,
          'UnsafeInput',
          'Only ordinary files and directories are allowed; links and special files are rejected',
        );
        return undefined;
      }
      return value;
    };
    const directory = (path: string): boolean => {
      const value = stat(path);
      if (!value) {
        if (!errors.some((e) => e.at.path === (path || '.')))
          error(path, 'InvalidLayout', 'Required directory is missing');
        return false;
      }
      if (!value.isDirectory()) {
        error(path, 'InvalidLayout', 'Expected a directory');
        return false;
      }
      return true;
    };
    const ordinaryFile = (path: string): boolean => {
      const value = stat(path);
      if (!value) {
        if (!errors.some((e) => e.at.path === (path || '.')))
          error(path, 'InvalidLayout', 'Required file is missing');
        return false;
      }
      if (!value.isFile()) {
        error(path, 'InvalidLayout', 'Expected an ordinary file');
        return false;
      }
      return true;
    };
    const entries = (path: string): readonly string[] => {
      current = path;
      return readdirSync(join(root, path)).sort();
    };
    const entry = (path: string, name: string): ReturnType<typeof lstatSync> | undefined => {
      const value = stat(path);
      if (!value) return undefined;
      const valid = value.isDirectory()
        ? NAME.test(name)
        : name === 'README.md' || name === 'tsconfig.json' || name === '.gitkeep' || FILE_NAME.test(name);
      if (!valid) {
        error(
          path,
          'InvalidLayout',
          'Invalid name: use lowercase letter, digit and hyphen names; README.md and .gitkeep are reserved exceptions',
        );
        return undefined;
      }
      if (value.isFile()) files.push(join(root, path));
      return value;
    };
    const scanMaterials = (path: string, place: Place): void => {
      directories.push({ path, place });
      ordinaryFile(`${path}/README.md`);
      for (const name of entries(path)) {
        const file = `${path}/${name}`;
        const value = entry(file, name);
        if (!value) continue;
        if (value.isDirectory()) {
          if (place.layer === 'architecture')
            scanMaterials(file, { layer: 'architecture', module: [...place.module, name] });
          else error(file, 'InvalidLayout', 'Business units and relations must be flat');
        } else if (name === '.gitkeep') continue;
        else if (name === 'tsconfig.json' && place.module.length === 0 && place.layer !== 'business')
          continue;
        else if (name === 'README.md' || /^[a-z][a-z0-9-]*\.md$/.test(name))
          documents.push({ path: file, place, kind: name === 'README.md' ? 'Readme' : 'Topic' });
        else if (/^[a-z][a-z0-9-]*\.ts$/.test(name)) types.push(join(root, file));
        else error(file, 'InvalidLayout', 'Only README.md, topic .md and type .ts files are allowed here');
      }
    };
    const scanAppendix = (path: string): void => {
      for (const name of entries(path)) {
        const file = `${path}/${name}`;
        const value = entry(file, name);
        if (value?.isDirectory()) scanAppendix(file);
      }
    };
    if (!directory('')) return reject(errors);
    const top = entries('');
    for (const name of top) {
      const value = entry(name, name);
      if (!value) continue;
      const isDirectory = ['dsl', 'architecture', 'business', 'relations', 'appendix'].includes(name);
      if (
        isDirectory
          ? !value.isDirectory()
          : !['README.md', 'tsconfig.json', '.gitkeep'].includes(name) || !value.isFile()
      )
        error(name, 'InvalidLayout', 'Unexpected design root entry');
    }
    ordinaryFile('README.md');
    ordinaryFile('tsconfig.json');
    for (const project of ['dsl', 'architecture', 'relations'] as const) {
      if (!directory(project)) continue;
      ordinaryFile(`${project}/tsconfig.json`);
      if (project === 'dsl') {
        ordinaryFile('dsl/dsl.ts');
        for (const name of entries(project)) {
          const path = `${project}/${name}`;
          const value = entry(path, name);
          if (value && (!value.isFile() || !['dsl.ts', 'tsconfig.json', '.gitkeep'].includes(name)))
            error(path, 'InvalidLayout', 'dsl only contains managed DSL and configuration files');
        }
      } else scanMaterials(project, { layer: project, module: [] });
    }
    const business = top.includes('business');
    if (business && directory('business')) {
      ordinaryFile('business/tsconfig.json');
      let units = 0;
      for (const name of entries('business')) {
        const path = `business/${name}`;
        const value = entry(path, name);
        if (!value) continue;
        if (value.isDirectory()) {
          units++;
          scanMaterials(path, { layer: 'business', module: [name] });
        } else if (!['tsconfig.json', '.gitkeep'].includes(name))
          error(
            path,
            'InvalidLayout',
            'business only contains direct unit directories and its configuration',
          );
      }
      if (units === 0) error('business', 'InvalidLayout', 'business must contain at least one unit');
    }
    if (directory('appendix')) {
      for (const name of entries('appendix')) {
        const path = `appendix/${name}`;
        const value = entry(path, name);
        if (!value) continue;
        if (value.isDirectory() && APPENDICES.some((expected) => expected === name)) scanAppendix(path);
        else if (name !== '.gitkeep' || !value.isFile())
          error(path, 'InvalidLayout', 'appendix only contains examples, evidence and reference directories');
      }
      for (const name of APPENDICES) directory(`appendix/${name}`);
    }
    if (errors.length) return reject(errors);
    const projects = [
      'tsconfig.json',
      'dsl/tsconfig.json',
      'architecture/tsconfig.json',
      ...(business ? ['business/tsconfig.json'] : []),
      'relations/tsconfig.json',
    ].map((path) => join(root, path));
    return {
      kind: 'Accepted',
      value: {
        business,
        source: {
          root,
          files: [...new Set(files)].sort(),
          types: types.sort(),
          documents: documents.sort((a, b) => a.path.localeCompare(b.path)),
          directories,
          projects,
        },
      },
    };
  } catch (cause) {
    return failure(root, current, 'UnsafeInput', `Unable to inspect design input: ${message(cause)}`);
  }
}

export function template(): Result<string> {
  try {
    return { kind: 'Accepted', value: readFileSync(new URL('../templates/dsl.ts', import.meta.url), 'utf8') };
  } catch (cause) {
    return failure('.', '.', 'MissingDependency', `Unable to read the skill DSL template: ${message(cause)}`);
  }
}

/** Requires a successful fresh layout inspection before reading any managed path. */
export function pendingGenerated(layout: Layout): Result<readonly GeneratedFile[]> {
  const dsl = template();
  if (dsl.kind === 'Rejected') return dsl;
  const writes: GeneratedFile[] = [];
  for (const generated of generatedFiles(layout.business, dsl.value)) {
    try {
      if (readFileSync(join(layout.source.root, generated.path), 'utf8') !== generated.content)
        writes.push(generated);
    } catch (cause) {
      return failure(
        layout.source.root,
        generated.path,
        'UnsafeInput',
        `Unable to read managed file: ${message(cause)}`,
      );
    }
  }
  return { kind: 'Accepted', value: writes };
}
