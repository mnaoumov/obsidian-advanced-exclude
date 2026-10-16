import { wrapCliTask } from '@mnaoumov/typescript-dev-toolkit/cli-utils';
import { test } from '@mnaoumov/typescript-dev-toolkit/test-runners/vitest';
import process from 'node:process';

/**
 * Each project runs TWICE, once per ignore-rules state.
 *
 * Two runs give two fresh vaults, so each frame shows one staged state and
 * neither depends on another state having been undone first — see the suite
 * header.
 */
const IGNORE_RULES_STATES = ['none', 'rules'];

// Desktop first, then Android — the two share one machine, and the Android leg
// boots an emulator, so running them concurrently would collide on the device.
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
