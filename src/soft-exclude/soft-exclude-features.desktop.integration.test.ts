import type {
  BacklinkView,
  GraphView,
  SearchView
} from '@obsidian-typings/obsidian-public-latest';

import { evalInObsidian } from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';

interface PluginWithSettingsComponent {
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface ViewSnapshot {
  readonly graph: string[];
  readonly isOtherIgnored: boolean;
  readonly search: string[];
  readonly unlinked: string[];
}

const PLUGIN_ID = 'advanced-exclude';
const SETTLE_DELAY_IN_MS = 3000;
const TEST_FOLDER = 'soft-exclude-features';

afterEach(async () => {
  await evalInObsidian({
    async callback({ app, FULL_MODE: fullMode, PLUGIN_ID: pluginId, SETTLE_DELAY_IN_MS: settleDelay, TEST_FOLDER: folder }) {
      const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
      await plugin?.pluginSettingsComponent.editAndSave((settings) => {
        settings.excludeMode = fullMode;
        settings.ignorePatterns = '';
        settings.shouldSoftExcludeFromGraph = true;
        settings.shouldSoftExcludeFromOtherFeatures = true;
        settings.shouldSoftExcludeFromSearch = true;
        settings.shouldSoftExcludeFromUnlinkedMentions = true;
      });
      await sleep(settleDelay);
      try {
        await app.vault.adapter.rmdir(folder, true);
      } catch {
        // Ignore
      }
    },
    input: { FULL_MODE: ExcludeMode.Full, PLUGIN_ID, SETTLE_DELAY_IN_MS, TEST_FOLDER },
    vaultPath: getTemporaryVault().path
  });
});

describe('Soft exclude mode per feature', () => {
  it('leaves an ignored file out of only the features whose toggle is on', async () => {
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil }, PLUGIN_ID: pluginId, SOFT_MODE: softMode, TEST_FOLDER: folder }) {
        const plugin = app.plugins.getPlugin(pluginId) as null | PluginWithSettingsComponent;
        if (!plugin) {
          throw new Error('Plugin not loaded');
        }
        await app.internalPlugins.getPluginById('graph')?.enable();
        await app.internalPlugins.getPluginById('backlink')?.enable();
        await app.internalPlugins.getPluginById('global-search')?.enable();

        const dropPath = `${folder}/drop.md`;
        const keepPath = `${folder}/keep.md`;
        await app.vault.createFolder(folder);
        const target = await app.vault.create(`${folder}/feature-target.md`, '# Target');
        await app.vault.create(dropPath, 'feature-target needle-word');
        await app.vault.create(keepPath, 'feature-target needle-word');
        await waitUntil({ message: 'notes indexed', predicate: () => app.metadataCache.getCache(dropPath) !== null && app.metadataCache.getCache(keepPath) !== null });

        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.excludeMode = softMode;
          settings.ignorePatterns = `${dropPath}\n`;
          settings.shouldSoftExcludeFromGraph = true;
          settings.shouldSoftExcludeFromOtherFeatures = false;
          settings.shouldSoftExcludeFromSearch = false;
          settings.shouldSoftExcludeFromUnlinkedMentions = true;
        });

        const noteLeaf = app.workspace.getLeaf('split');
        await noteLeaf.openFile(target);
        const graphLeaf = app.workspace.getLeaf('split');
        await graphLeaf.setViewState({ type: 'graph' });
        await app.workspace.revealLeaf(graphLeaf);
        const backlinkLeaf = app.workspace.getRightLeaf(false);
        const searchLeaf = app.workspace.getLeftLeaf(false);
        if (!backlinkLeaf || !searchLeaf) {
          throw new Error('No side leaf');
        }
        await backlinkLeaf.setViewState({ state: { file: target.path, unlinkedCollapsed: false }, type: 'backlink' });
        await app.workspace.revealLeaf(backlinkLeaf);
        await searchLeaf.setViewState({ state: { query: 'needle-word' }, type: 'search' });
        await app.workspace.revealLeaf(searchLeaf);
        app.workspace.setActiveLeaf(noteLeaf, { focus: true });

        const graph = graphLeaf.view as GraphView;
        const backlink = (backlinkLeaf.view as BacklinkView).backlink;
        const search = searchLeaf.view as SearchView;

        function inFolder(paths: Iterable<string>): string[] {
          return [...paths].filter((path) => path === dropPath || path === keepPath).sort();
        }

        function readViews(): ViewSnapshot {
          return {
            graph: inFolder(graph.renderer.nodes.map((node) => node.id)),
            isOtherIgnored: app.metadataCache.isUserIgnored(dropPath),
            search: inFolder([...search.dom.resultDomLookup.keys()].map((file) => file.path)),
            unlinked: inFolder([...backlink.unlinkedDom.resultDomLookup.keys()].map((file) => file.path))
          };
        }

        function isSnapshot(expected: ViewSnapshot): boolean {
          return JSON.stringify(readViews()) === JSON.stringify(expected);
        }

        const firstExpected: ViewSnapshot = { graph: [keepPath], isOtherIgnored: false, search: [dropPath, keepPath], unlinked: [keepPath] };
        const secondExpected: ViewSnapshot = { graph: [dropPath, keepPath], isOtherIgnored: true, search: [keepPath], unlinked: [dropPath, keepPath] };
        const stages: ViewSnapshot[] = [];
        try {
          try {
            await waitUntil({ message: 'views follow the first toggles', predicate: () => isSnapshot(firstExpected) });
          } finally {
            stages.push(readViews());
          }

          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.shouldSoftExcludeFromGraph = false;
            settings.shouldSoftExcludeFromOtherFeatures = true;
            settings.shouldSoftExcludeFromSearch = true;
            settings.shouldSoftExcludeFromUnlinkedMentions = false;
          });
          try {
            await waitUntil({ message: 'views follow the flipped toggles', predicate: () => isSnapshot(secondExpected) });
          } finally {
            stages.push(readViews());
          }
        } catch (error) {
          return { error: String(error), stages };
        } finally {
          graphLeaf.detach();
          backlinkLeaf.detach();
          searchLeaf.detach();
          noteLeaf.detach();
        }
        return { error: null, stages };
      },
      input: { PLUGIN_ID, SOFT_MODE: ExcludeMode.Soft, TEST_FOLDER },
      vaultPath: getTemporaryVault().path
    });

    const dropPath = `${TEST_FOLDER}/drop.md`;
    const keepPath = `${TEST_FOLDER}/keep.md`;
    expect(result).toEqual({
      error: null,
      stages: [
        // Graph and unlinked mentions on, search and the rest off.
        { graph: [keepPath], isOtherIgnored: false, search: [dropPath, keepPath], unlinked: [keepPath] },
        // Flipped.
        { graph: [dropPath, keepPath], isOtherIgnored: true, search: [keepPath], unlinked: [dropPath, keepPath] }
      ]
    });
  });
});
