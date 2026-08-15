/**
 * @file
 *
 * Produces the mobile screenshots the community-store listing needs
 * (T461-P21), driving a staged vault in Obsidian Mobile on a real Android
 * emulator and writing images/screenshots/screenshot-mobile-N.png.
 *
 * The mobile counterpart of the desktop capture suite, and it inherits the same
 * two-run structure: the plugin reads its rules when the vault loads, so the
 * pair needs two vaults. See the desktop suite for the full reasoning.
 *
 * There is no mobile equivalent of the desktop viewport override, so the AVD is
 * built at exactly 900x1600 — see [[T461-P21]] for its one-time provisioning.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/**
 * App, reduced to the font-size applier that obsidian-typings does not declare.
 * Setting baseFontSize alone changes nothing on screen.
 */
interface FontSizeApp {
  updateFontSize(this: void): void;
}

const WIDTH_IN_PIXELS = 900;
const HEIGHT_IN_PIXELS = 1600;

/**
 * Base font size for the mobile shots, below the 16px default so the whole tree
 * fits a 450dp screen.
 */
const MOBILE_FONT_SIZE_IN_PIXELS = 13;

/**
 * The folder the ignore rules hide.
 */
const IGNORED_FOLDER = 'archive';

/**
 * Which of the two frames this run takes. `rules` stages the ignore file before
 * the vault opens, which is when the plugin reads it.
 */
const SHOULD_IGNORE = process.env['SCREENSHOT_IGNORE_RULES'] === 'rules';

const IGNORE_FILE_PATH = '.obsidianignore';

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

beforeAll(async () => {
  const vault = getTemporaryVault();

  vault.populate({
    [`${IGNORED_FOLDER}/2019 notes.md`]: '# 2019 notes\n',
    [`${IGNORED_FOLDER}/2020 notes.md`]: '# 2020 notes\n',
    [`${IGNORED_FOLDER}/old drafts/scratch.md`]: '# Scratch\n',
    [IGNORE_FILE_PATH]: SHOULD_IGNORE ? buildIgnoreRules() : '# Nothing ignored yet\n',
    'Projects/Alpha.md': '# Alpha\n',
    'Projects/Beta.md': '# Beta\n',
    'Reading list.md': '# Reading list\n'
  });
  await vault.syncToDevice();

  await evalInObsidian({
    async callback({ app, fontSizeInPixels, lib: { waitUntil } }) {
      // A closure runs inside ONE Appium execute/sync call, which WebDriver caps
      // Around 30s, so every wait in here stays comfortably under it.
      const SETTLE_TIMEOUT_IN_MILLISECONDS = 15_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;

      app.changeTheme('obsidian');

      app.vault.setConfig('baseFontSize', fontSizeInPixels);
      const fontApp: unknown = app;
      (fontApp as FontSizeApp).updateFontSize();

      // The file explorer IS the subject here, so it is the one thing that must
      // Be open — the opposite of most of these suites, which collapse it.
      app.workspace.leftSplit.expand();
      const fileExplorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
      if (fileExplorerLeaf) {
        await app.workspace.revealLeaf(fileExplorerLeaf);
      }

      await waitUntil({
        message: 'the file explorer to list the staged files',
        predicate: () => document.querySelectorAll('.nav-files-container .nav-file').length > 0,
        timeoutInMilliseconds: SETTLE_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);
    },
    input: { fontSizeInPixels: MOBILE_FONT_SIZE_IN_PIXELS },
    vaultPath: vaultPath()
  });
});

describe('mobile store screenshots', () => {
  it('takes the frame this run stages', async () => {
    const names = await readExplorer();

    if (SHOULD_IGNORE) {
      expect(names).not.toContain(IGNORED_FOLDER);
      await shoot(2, 'One gitignore line later, they are not there at all');
      return;
    }

    // A before-shot is only safe BECAUSE of the caption. A listing carousel
    // Shows screenshots one at a time, so an unlabelled one reads as a picture
    // Of what the plugin does, not of what it fixes.
    expect(names).toContain(IGNORED_FOLDER);
    await shoot(1, 'Excluded files still sit in your file explorer');
  });
});

/**
 * Builds the ignore rules the second run stages.
 *
 * Written the way a real one is — a comment, a folder, a glob — so what is shown
 * is the gitignore syntax the README promises rather than a single bare line.
 *
 * @returns The file's content.
 */
function buildIgnoreRules(): string {
  return '# Anything in here is treated as though it is not in the vault\n'
    + `${IGNORED_FOLDER}/\n`
    + '\n'
    + '# Scratch files, wherever they are\n'
    + '**/*.tmp.md\n';
}

/**
 * Reads what the file explorer is currently showing.
 *
 * @returns The names on screen, joined.
 */
async function readExplorer(): Promise<string> {
  return await evalInObsidian({
    async callback({ lib: { waitUntil } }) {
      const RENDER_TIMEOUT_IN_MILLISECONDS = 20_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;

      await waitUntil({
        message: 'the file explorer to render',
        predicate: () => document.querySelectorAll('.nav-files-container .nav-file').length > 0,
        timeoutInMilliseconds: RENDER_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return [...document.querySelectorAll('.nav-files-container .nav-file-title-content, .nav-files-container .nav-folder-title-content')]
        .map((entry) => entry.textContent)
        .join(' | ');
    },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/screenshot-mobile-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const captured = await captureObsidianScreenshot({ vaultPath: vaultPath() });

  // The AVD is 900x1600, so the device frame IS the store size. Asserting it
  // Here is what keeps that true: run this against any other AVD and it fails
  // Loudly instead of quietly shipping an off-spec image.
  expect(readPngDimensions(captured)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(captured, { text: caption });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-mobile-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}
