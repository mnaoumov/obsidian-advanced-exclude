/**
 * @file
 *
 * Produces the desktop screenshots the community-store listing needs
 * (T461-P21), driving a staged vault in a real Obsidian and writing
 * `images/screenshots/screenshot-desktop-N.png`.
 *
 * TWO shots, both of the FILE EXPLORER: the plugin's claim is that ignored files
 * stop being there, and the explorer is where that is visible.
 *
 * **This suite takes ONE of the two shots per run**, chosen by
 * `SCREENSHOT_IGNORE_RULES`, and `npm run capture:screenshots` runs it twice.
 * That is not a preference — it is the only honest way to get the pair. The
 * plugin reads its rules when the vault loads, so within a single run the
 * before-state cannot be recovered: disabling the plugin does not put the files
 * back (it drops them from the index at load and nothing re-adds them), and
 * neither writing `.obsidianignore` nor setting `obsidianIgnoreContent` and
 * reloading the plugin moved them either way. Two runs, two vaults, two honest
 * frames.
 *
 * Each shot asserts what it claims — the archived notes present, then absent —
 * so a run that staged the wrong rules fails instead of shipping a frame that
 * contradicts its caption.
 *
 * There is no shot of the rules themselves: they live in a plugin setting, and
 * Obsidian's settings tab does not render under CDP.
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

const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;

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
    async callback({ app, lib: { waitUntil } }) {
      const SETTLE_TIMEOUT_IN_MILLISECONDS = 30_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1000;

      app.changeTheme('obsidian');

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
    vaultPath: vaultPath()
  });
});

describe('desktop store screenshots', () => {
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
 * `images/screenshots/screenshot-desktop-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}
