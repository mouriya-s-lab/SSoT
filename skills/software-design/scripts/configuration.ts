import type { GeneratedFile } from './workspace-model.ts';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
type Project = 'dsl' | 'architecture' | 'business' | 'relations';

function projectConfig(project: Project, business: boolean): string {
  const compilerOptions = {
    strict: true,
    composite: true,
    declaration: true,
    emitDeclarationOnly: true,
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    allowImportingTsExtensions: true,
    rootDir: '.',
    outDir: `../../.design-build/${project}`,
    tsBuildInfoFile: `../../.design-build/${project}/tsconfig.tsbuildinfo`,
  };
  if (project === 'dsl') return json({ compilerOptions, files: ['dsl.ts'] });
  const dependencies: readonly Project[] =
    project === 'architecture'
      ? ['dsl']
      : project === 'business'
        ? ['architecture', 'dsl']
        : ['architecture', ...(business ? ['business' as const] : []), 'dsl'];
  return json({
    compilerOptions,
    files: [],
    include: ['./**/*.ts'],
    references: dependencies.map((path) => ({ path: `../${path}` })),
  });
}

/** Fixed tool-owned paths, relative to the design root; no files are written here. */
export function generatedFiles(business: boolean, dsl: string): readonly GeneratedFile[] {
  const projects: readonly Project[] = [
    'dsl',
    'architecture',
    ...(business ? ['business' as const] : []),
    'relations',
  ];
  return [
    {
      kind: 'Configuration',
      path: 'tsconfig.json',
      content: json({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          allowImportingTsExtensions: true,
        },
        include: [
          'dsl/dsl.ts',
          'architecture/**/*.ts',
          ...(business ? ['business/**/*.ts'] : []),
          'relations/**/*.ts',
        ],
        references: projects.map((path) => ({ path: `./${path}` })),
      }),
    },
    { kind: 'Dsl', path: 'dsl/dsl.ts', content: dsl },
    ...projects.map((project): GeneratedFile => ({
      kind: 'Configuration',
      path: `${project}/tsconfig.json`,
      content: projectConfig(project, business),
    })),
  ];
}
