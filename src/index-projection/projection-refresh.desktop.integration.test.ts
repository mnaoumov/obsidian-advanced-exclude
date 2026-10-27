import type {
  BacklinkView,
  GraphView,
  LocalGraphView
} from '@obsidian-typings/obsidian-public-latest';

// Cspell:ignore localgraph
import {
  createTransportFromOptions,
  evalInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  expect,
  inject,
  it
} from 'vitest';

import type { PluginSettingsComponent } from '../settings/plugin-settings-component.ts';
import type { ManualIndexHider } from './manual-index-hider.ts';

interface PluginWithSettings {
  readonly _children: readonly ProjectionChild[];
  readonly pluginSettingsComponent: PluginSettingsComponent;
}

interface ProjectionChild {
  readonly _children?: readonly ProjectionChild[];
  readonly manualIndexHider?: ManualIndexHider;
}

interface ViewSnapshot {
  readonly backlinks: string;
  readonly graphHasSource: boolean;
  readonly localGraphHasSource: boolean;
}

it('refreshes open graphs and backlinks for snapshot and snapshot-free restores without deletion events', async () => {
  const result = await evalInObsidian({
    async callback({ app, lib: { waitUntil }, localGraphType }) {
      await app.internalPlugins.getPluginById('graph')?.enable();
      await app.internalPlugins.getPluginById('backlink')?.enable();
      const target = await app.vault.create('refresh-target.md', '# Target');
      await app.vault.create('refresh-source.md', '[[refresh-target]]');
      await waitUntil({ message: 'source link indexed', predicate: () => Boolean(app.metadataCache.resolvedLinks['refresh-source.md']?.['refresh-target.md']) });
      const noteLeaf = app.workspace.getLeaf('split');
      await noteLeaf.openFile(target);
      const graphLeaf = app.workspace.getLeaf('split');
      await graphLeaf.setViewState({ type: 'graph' });
      await app.workspace.revealLeaf(graphLeaf);
      const graph = graphLeaf.view as GraphView;
      const localGraphLeaf = app.workspace.getLeaf('split');
      await localGraphLeaf.setViewState({ state: { file: target.path }, type: localGraphType });
      await app.workspace.revealLeaf(localGraphLeaf);
      const localGraph = localGraphLeaf.view as LocalGraphView;
      const backlinkLeaf = app.workspace.getRightLeaf(false);
      if (!backlinkLeaf) {
        throw new Error('No right leaf');
      }
      await backlinkLeaf.setViewState({ state: { file: target.path }, type: 'backlink' });
      await app.workspace.revealLeaf(backlinkLeaf);
      app.workspace.setActiveLeaf(noteLeaf, { focus: true });
      const backlink = (backlinkLeaf.view as BacklinkView).backlink;
      const plugin = app.plugins.getPlugin('advanced-exclude') as null | PluginWithSettings;
      function findHider(children: readonly ProjectionChild[]): ManualIndexHider | undefined {
        for (const child of children) {
          const hider = child.manualIndexHider ?? findHider(child._children ?? []);
          if (hider) {
            return hider;
          }
        }
        return undefined;
      }
      const hider = findHider(plugin?._children ?? []);
      if (!plugin || !hider) {
        throw new Error('Plugin projection missing');
      }
      function readViews(): ViewSnapshot {
        return {
          backlinks: backlink.backlinkCountEl.textContent,
          graphHasSource: graph.renderer.nodes.some((node) => node.id === 'refresh-source.md'),
          localGraphHasSource: localGraph.renderer.nodes.some((node) => node.id === 'refresh-source.md')
        };
      }
      await waitUntil({
        message: 'initial graphs and backlink rendered',
        predicate: () => {
          const views = readViews();
          return views.graphHasSource && views.localGraphHasSource && views.backlinks === '1';
        }
      });
      const stages = [];
      let deletes = 0;
      let creates = 0;
      const deleteRef = app.vault.on('delete', () => {
        deletes++;
      });
      const createRef = app.vault.on('create', () => {
        creates++;
      });
      const originalPatterns = plugin.pluginSettingsComponent.settings.ignorePatterns;
      try {
        for (const shouldDropSnapshot of [false, true]) {
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.ignorePatterns = 'refresh-source.md';
          });
          await waitUntil({
            message: 'hidden source removed from open graphs and backlinks',
            predicate: () => {
              const views = readViews();
              return !views.graphHasSource && !views.localGraphHasSource && views.backlinks === '0';
            }
          });
          stages.push({ ...readViews(), creates, deletes });
          if (shouldDropSnapshot) {
            // A prior-session hidden path has no snapshot. Force that same reconciliation fallback.
            hider.dropStaleSnapshot('refresh-source.md');
          }
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.ignorePatterns = '';
          });
          await waitUntil({
            message: 'restored source returned to open graphs and backlinks',
            predicate: () => {
              const views = readViews();
              return views.graphHasSource && views.localGraphHasSource && views.backlinks === '1';
            }
          });
          stages.push({ ...readViews(), creates, deletes });
        }
      } finally {
        app.vault.offref(deleteRef);
        app.vault.offref(createRef);
        await plugin.pluginSettingsComponent.editAndSave((settings) => {
          settings.ignorePatterns = originalPatterns;
        });
        graphLeaf.detach();
        localGraphLeaf.detach();
        backlinkLeaf.detach();
        noteLeaf.detach();
        for (const path of ['refresh-source.md', 'refresh-target.md']) {
          const file = app.vault.getFileByPath(path);
          if (file) {
            await app.fileManager.trashFile(file);
          }
        }
      }
      return stages;
    },
    input: { localGraphType: 'localgraph' },
    vaultPath: getTemporaryVault().path
  });
  expect(result).toEqual([
    { backlinks: '0', creates: 0, deletes: 0, graphHasSource: false, localGraphHasSource: false },
    { backlinks: '1', creates: 0, deletes: 0, graphHasSource: true, localGraphHasSource: true },
    { backlinks: '0', creates: 0, deletes: 0, graphHasSource: false, localGraphHasSource: false },
    { backlinks: '1', creates: 1, deletes: 0, graphHasSource: true, localGraphHasSource: true }
  ]);
});

it('refreshes graphs and backlinks when showing a note hidden across a real app reload', async () => {
  const vaultPath = getTemporaryVault().path;
  await evalInObsidian({
    async callback({ app, lib: { waitUntil } }) {
      await app.vault.create('restart-refresh-target.md', '# Target');
      await app.vault.create('restart-refresh-source.md', '[[restart-refresh-target]]');
      await waitUntil({ message: 'restart fixture indexed', predicate: () => Boolean(app.metadataCache.resolvedLinks['restart-refresh-source.md']?.['restart-refresh-target.md']) });
      const plugin = app.plugins.getPlugin('advanced-exclude') as null | PluginWithSettings;
      if (!plugin) {
        throw new Error('Plugin missing');
      }
      await plugin.pluginSettingsComponent.editAndSave((settings) => {
        settings.ignorePatterns = 'restart-refresh-source.md';
      });
    },
    vaultPath
  });
  const options = inject('obsidianTransport');
  const transport = await createTransportFromOptions(options);
  try {
    const previousOrigin = await transport.evaluate('String(performance.timeOrigin)', { cwd: vaultPath });
    await transport.evaluate('window.setTimeout(() => window.location.reload(), 0); "scheduled"', { cwd: vaultPath });
    // Observe startup without loading a temporary plugin in the new, still-initializing document.
    await expect.poll(async () => {
      try {
        return await transport.evaluate(`JSON.stringify(performance.timeOrigin !== ${previousOrigin} && Boolean(window.app?.workspace?.layoutReady && window.app?.plugins?.getPlugin('advanced-exclude')) && window.app.metadataCache.inProgressTaskCount === 0)`, { cwd: vaultPath });
      } catch {
        return 'false';
      }
    }, { timeout: 30_000 }).toBe('true');
    const result = await evalInObsidian({
      async callback({ app, lib: { waitUntil } }) {
        const plugin = app.plugins.getPlugin('advanced-exclude') as null | PluginWithSettings;
        const target = app.vault.getFileByPath('restart-refresh-target.md');
        if (!plugin || !target) {
          throw new Error('Restart fixture missing');
        }
        const noteLeaf = app.workspace.getLeaf('split');
        await noteLeaf.openFile(target);
        const graphLeaf = app.workspace.getLeaf('split');
        await graphLeaf.setViewState({ type: 'graph' });
        await app.workspace.revealLeaf(graphLeaf);
        const graph = graphLeaf.view as GraphView;
        const backlinkLeaf = app.workspace.getRightLeaf(false);
        if (!backlinkLeaf) {
          throw new Error('No right leaf');
        }
        await backlinkLeaf.setViewState({ state: { file: target.path }, type: 'backlink' });
        await app.workspace.revealLeaf(backlinkLeaf);
        app.workspace.setActiveLeaf(noteLeaf, { focus: true });
        const backlink = (backlinkLeaf.view as BacklinkView).backlink;
        const isHiddenAtStartup = app.vault.getFileByPath('restart-refresh-source.md') === null;
        try {
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.ignorePatterns = '';
          });
          await waitUntil({ message: 'cross-session show refreshed graphs and backlinks', predicate: () => graph.renderer.nodes.some((node) => node.id === 'restart-refresh-source.md') && backlink.backlinkCountEl.textContent === '1' });
          return { backlinks: backlink.backlinkCountEl.textContent, hiddenAtStartup: isHiddenAtStartup };
        } finally {
          graphLeaf.detach();
          backlinkLeaf.detach();
          noteLeaf.detach();
          await plugin.pluginSettingsComponent.editAndSave((settings) => {
            settings.ignorePatterns = '';
          });
          for (const path of ['restart-refresh-source.md', 'restart-refresh-target.md']) {
            const file = app.vault.getFileByPath(path);
            if (file) {
              await app.fileManager.trashFile(file);
            }
          }
        }
      },
      vaultPath
    });
    expect(result).toEqual({ backlinks: '1', hiddenAtStartup: true });
  } finally {
    await transport.dispose?.();
  }
});
