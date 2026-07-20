import type { App } from 'obsidian';

import { Notice } from 'obsidian';
import {
  enableCommunityPlugin,
  installCommunityPlugin
} from 'obsidian-dev-utils/obsidian/community-plugins';

// Advanced Exclude is configured through its settings tab (ignore patterns) and reacts to the
// Vault's files, so there is nothing for a code-button to drive - the demo notes walk through it
// Manually. The only helper the vault needs is the shared CodeScript Toolkit installer used by the
// Prerequisite note's button.
export async function installAndEnable(app: App, pluginId: string): Promise<void> {
  await installCommunityPlugin({ app, pluginId });
  await enableCommunityPlugin({ app, pluginId });
  new Notice(`Installed and enabled: ${pluginId}`);
}
