import type { Place } from './model.ts';
export type GeneratedFile = {
  readonly kind: 'Dsl' | 'Configuration';
  readonly path: string;
  readonly content: string;
};
export type Document = { readonly path: string; readonly place: Place; readonly kind: 'Readme' | 'Topic' };
export type SourceSet = {
  readonly root: string;
  readonly files: readonly string[];
  readonly types: readonly string[];
  readonly documents: readonly Document[];
  readonly projects: readonly string[];
  readonly directories: readonly { readonly path: string; readonly place: Place }[];
};
export type WorkspaceChange = {
  readonly kind: 'Generated';
  readonly root: string;
  readonly written: readonly string[];
};
export type UpgradePlan =
  | { readonly kind: 'UpToDate' }
  | { readonly kind: 'UpgradeAvailable'; readonly writes: readonly GeneratedFile[] };
