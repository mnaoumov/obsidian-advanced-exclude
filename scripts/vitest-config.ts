import type { ObsidianPluginVitestConfigContext } from 'obsidian-dev-utils/script-utils/test-runners/vitest-config';
import type {
  TestProjectConfiguration,
  ViteUserConfig
} from 'vitest/config';

import { defineObsidianPluginVitestConfig } from 'obsidian-dev-utils/script-utils/test-runners/vitest-config';

/**
 * The screenshot-capture suites that write
 * `images/screenshots/screenshot-*.png`.
 *
 * They are named `*.desktop-capture.` / `*.android-capture.` rather than
 * `*.desktop.` / `*.android.` so they match NONE of the standard project globs.
 * That keeps them out of `npm run test:integration` entirely — capturing is an
 * explicit operation (`npm run capture:screenshots`), not something every test
 * run does. Folding them into the standard projects would rewrite ten PNGs on
 * every run and dirty the tree mid-release.
 */
const DESKTOP_CAPTURE_TEST_FILES = 'src/**/*.desktop-capture.integration.test.ts';
const ANDROID_CAPTURE_TEST_FILES = 'src/**/*.android-capture.integration.test.ts';

/**
 * The AVD the mobile shots are taken on: 900x1600 at density 320, which is
 * exactly the size the community store asks for, so the capture needs no crop,
 * no rescale and no letterbox. The shared `obsidian_test` AVD is a Pixel 10 Pro
 * XL at 1344x2994 (~9:20) and cannot produce it; resizing that one at runtime
 * destroys the Appium session, because the display change recreates the
 * activity and with it the WebView the session is attached to.
 *
 * Needs one-time provisioning, and all three steps are non-obvious:
 *
 * 1. The harness never installs the Obsidian APK. It launches the emulator and
 *    starts `md.obsidian`, so a fresh AVD fails with `Activity class
 *    {md.obsidian/md.obsidian.MainActivity} does not exist`.
 * 2. An install only persists if the emulator SAVES ITS SNAPSHOT. The harness
 *    launches with `-no-snapshot-save`, which discards everything the session
 *    did: an `adb install` under that flag reports `Success` and the package is
 *    gone on the next boot. Boot WITHOUT the flag, install, then `adb emu kill`.
 * 3. Obsidian's first-run onboarding has to be completed by hand once. Until
 *    someone taps through the vault-creation flow, the app sits on its welcome
 *    screen, `layoutReady` never becomes true, and setup fails after the FULL
 *    timeout with `Obsidian layout did not become ready`.
 */
const SCREENSHOT_AVD_NAME = 'obsidian_screenshots';

const APPIUM_URL = 'http://localhost:4723';

/**
 * This AVD is cold-booted and rarely used, so Obsidian's first layout on it is
 * far slower than on the well-warmed shared one; the 90s default expires while
 * it is still starting up.
 */
const LAYOUT_READY_TIMEOUT_IN_MILLISECONDS = 240_000;

/**
 * The demo-vault button suite. It drives a real desktop Obsidian like the desktop project, but opens
 * a copy of the in-repo `demo-vault/` rather than an empty vault — hence its own `globalSetup` — and
 * needs its own suffix so the desktop project does not also collect it and open it against a vault
 * with no notes in it.
 */
const DEMO_VAULT_TEST_FILES = 'src/**/*.demo-vault.integration.test.ts';

/**
 * One `it` per note runs every button in that note, and each button re-opens the note, walks the
 * preview to find itself and then waits up to 15s for a result. A note with a dozen buttons therefore
 * blows well past the desktop project's 30s default — which fails the whole note with a bare vitest
 * timeout instead of naming the button that actually misbehaved.
 */
const DEMO_VAULT_TIMEOUT_IN_MILLISECONDS = 600_000;

/**
 * Drops the root-level `include` the shared factory still sets on this `obsidian-dev-utils` line.
 *
 * Under vitest 5 a project's own `include` no longer replaces the root one, and the root
 * `src/**\/*.test.ts` is a superset of every project glob, so EVERY project collected EVERY test
 * file: unit suites ran under the CDP transport, and the screenshot-capture suites ran from
 * `npm run test:integration` and rewrote the checked-in PNGs. `obsidian-dev-utils` 101.7.0 removed
 * the root `include` itself; this wrapper is dead once the dependency is floated past it.
 *
 * @param baseConfig - The configuration the shared factory built.
 * @returns The same configuration without the root `include`.
 */
function withoutRootInclude(baseConfig: ViteUserConfig): ViteUserConfig {
  const test = { ...baseConfig.test };
  delete test.include;
  return { ...baseConfig, test };
}

export const config = withoutRootInclude(defineObsidianPluginVitestConfig({
  customProjects(context: ObsidianPluginVitestConfigContext): TestProjectConfiguration[] {
    return [
      {
        test: {
          ...context.desktop,
          include: [DESKTOP_CAPTURE_TEST_FILES],
          name: 'capture-screenshots:desktop'
        }
      },
      {
        test: {
          ...context.android,
          environmentOptions: {
            obsidianTransport: {
              appiumUrl: APPIUM_URL,
              avdName: SCREENSHOT_AVD_NAME,
              layoutReadyTimeoutInMilliseconds: LAYOUT_READY_TIMEOUT_IN_MILLISECONDS,
              type: 'obsidian-android-appium'
            }
          },
          include: [ANDROID_CAPTURE_TEST_FILES],
          name: 'capture-screenshots:android'
        }
      },
      {
        test: {
          ...context.desktop,
          globalSetup: ['./scripts/demo-vault-global-setup.ts'],
          include: [DEMO_VAULT_TEST_FILES],
          name: 'integration-tests:demo-vault',
          testTimeout: DEMO_VAULT_TIMEOUT_IN_MILLISECONDS
        }
      }
    ];
  },
  editContext(context: ObsidianPluginVitestConfigContext): void {
    context.desktopPerformance.environmentOptions = {
      /*
       * The real-scale suites wait for Obsidian's startup scan of the ~90k-note vault inside a
       * single `Runtime.evaluate`, which far exceeds the transport's default 30s per-command
       * timeout, so raise it to the performance test budget.
       */
      obsidianTransport: {
        commandTimeoutInMilliseconds: context.performanceTimeoutInMilliseconds,
        type: 'obsidian-cdp'
      }
    };

    /*
     * The performance vault is pre-populated with a large note tree before open, which the
     * shared global setup knows nothing about. Every suite in this project asserts against it.
     */
    context.desktopPerformance.globalSetup = ['./scripts/vitest-global-setup-performance.ts'];
  }
}));
