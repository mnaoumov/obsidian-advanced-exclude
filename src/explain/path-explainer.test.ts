import type {
  App,
  Stat,
  TAbstractFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  TFile,
  TFolder
} from 'obsidian-test-mocks/obsidian';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from '../patterns/ignore-patterns-component.ts';
import type { SoftExcludePatchComponent } from '../soft-exclude/soft-exclude-patch-component.ts';
import type { PathExplanation } from './path-explanation.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';
import { createFakeSettings } from '../test-helpers/fake-plugin-settings-component.ts';
import { PathExplainer } from './path-explainer.ts';

const NO_MATCH = { decidingLine: null, excludedFolderPath: null, isIgnored: false, overriddenLines: [] };
const NO_SOFT = { excludedFeatures: [], isSoftMode: false, propertyRule: null, softPatterns: null };

interface Setup {
  readonly explainer: PathExplainer;
  readonly explainMain: ReturnType<typeof vi.fn<IgnorePatternsComponent['explain']>>;
  readonly explainSoft: ReturnType<typeof vi.fn<SoftExcludePatchComponent['explain']>>;
  readonly stat: ReturnType<typeof vi.fn<(path: string) => Promise<null | Stat>>>;
}

async function explainTyped(explainer: PathExplainer, typedPath: string): Promise<null | PathExplanation> {
  return await explainer.explainTypedPath(typedPath);
}

describe('PathExplainer', () => {
  function setup(): Setup {
    const dummyVault = castTo<Parameters<typeof TFile.create__>[0]>({});
    const vaultFiles = new Map<string, TAbstractFile>([
      ['Notes', castTo<TAbstractFile>(TFolder.create__(dummyVault, 'Notes'))],
      ['Notes/a.md', castTo<TAbstractFile>(TFile.create__(dummyVault, 'Notes/a.md'))]
    ]);
    const stat = vi.fn((path: string): Promise<null | Stat> => Promise.resolve(path === 'Hidden' ? castTo<Stat>({ type: 'folder' }) : (path === 'Hidden/x.md' ? castTo<Stat>({ type: 'file' }) : null)));
    const app = strictProxy<App>({
      vault: {
        adapter: { stat },
        getAbstractFileByPath: (path: string): null | TAbstractFile => vaultFiles.get(path) ?? null
      }
    });
    const explainMain = vi.fn<IgnorePatternsComponent['explain']>(() => ({ excludedFilesEntry: null, isIgnored: false, patterns: NO_MATCH }));
    const explainSoft = vi.fn<SoftExcludePatchComponent['explain']>(() => NO_SOFT);
    const fake = createFakeSettings();
    fake.settings.excludeMode = ExcludeMode.FilesPane;
    const explainer = new PathExplainer({
      app,
      ignorePatternsComponent: strictProxy<IgnorePatternsComponent>({ explain: explainMain }),
      pluginSettingsComponent: fake.pluginSettingsComponent,
      softExcludePatchComponent: strictProxy<SoftExcludePatchComponent>({ explain: explainSoft })
    });
    return { explainer, explainMain, explainSoft, stat };
  }

  it('combines the main and the soft explanations under the exclude mode', () => {
    const { explainer, explainMain, explainSoft } = setup();

    expect(explainer.explain('Notes/a.md', false)).toStrictEqual({
      excludeMode: ExcludeMode.FilesPane,
      isFolder: false,
      main: { excludedFilesEntry: null, isIgnored: false, patterns: NO_MATCH },
      path: 'Notes/a.md',
      soft: NO_SOFT
    });
    expect(explainMain).toHaveBeenCalledWith({ isFolder: false, normalizedPath: 'Notes/a.md' });
    expect(explainSoft).toHaveBeenCalledWith('Notes/a.md', false);
  });

  it('reads whether a typed path is a folder from the vault, then from the disk, then from a trailing slash', async () => {
    const { explainer, stat } = setup();

    const notes = await explainTyped(explainer, ' Notes ');
    expect(notes?.isFolder).toBe(true);
    expect(stat).not.toHaveBeenCalled();
    const note = await explainTyped(explainer, 'Notes//a.md');
    expect(note?.path).toBe('Notes/a.md');
    const hidden = await explainTyped(explainer, 'Hidden');
    expect(hidden?.isFolder).toBe(true);
    const hiddenNote = await explainTyped(explainer, 'Hidden/x.md');
    expect(hiddenNote?.isFolder).toBe(false);
    const planned = await explainTyped(explainer, 'Planned/');
    expect(planned?.isFolder).toBe(true);
    const plannedNote = await explainTyped(explainer, 'Planned/y.md');
    expect(plannedNote?.isFolder).toBe(false);
  });

  it('explains nothing for the vault root', async () => {
    const { explainer } = setup();

    expect(await explainer.explainTypedPath('/')).toBeNull();
    expect(await explainer.explainTypedPath('  ')).toBeNull();
  });
});
