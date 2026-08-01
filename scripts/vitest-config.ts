import { defineObsidianPluginVitestConfig } from 'obsidian-dev-utils/script-utils/test-runners/vitest-config';

export const config = defineObsidianPluginVitestConfig({
  editContext(context) {
    /*
     * The performance vault is pre-populated before open, which the shared global setup knows nothing
     * about.
     */
    context.desktopPerformance.globalSetup = ['./scripts/vitest-global-setup-performance.ts'];
  }
});
