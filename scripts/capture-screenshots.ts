import process from 'node:process';
import { wrapCliTask } from 'obsidian-dev-utils/script-utils/cli-utils';
import { test } from 'obsidian-dev-utils/script-utils/test-runners/vitest';

/**
 * Each project runs TWICE, once per ignore-rules state.
 *
 * The plugin reads its rules when the vault loads, so the before-state cannot be
 * recovered inside a run that already applied them — see the suite header. Two
 * runs give two vaults and therefore two honest frames.
 */
const IGNORE_RULES_STATES = ['none', 'rules'];

// Desktop first, then Android — the two share one machine, and the Android leg
// Boots an emulator, so running them concurrently would collide on the device.
await wrapCliTask(async () => {
  for (const projectName of ['capture-screenshots:desktop', 'capture-screenshots:android']) {
    for (const state of IGNORE_RULES_STATES) {
      process.env['SCREENSHOT_IGNORE_RULES'] = state;
      await test({
        projects: [projectName]
      });
    }
  }
});
