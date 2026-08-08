import type { PopulateFilesParams } from 'obsidian-integration-testing';

/**
 * The single ignored folder the performance vault hangs everything under. The
 * `vault-real-scale.desktop-performance.integration.test.ts` test ignores this
 * folder, so the two must agree.
 */
export const PERFORMANCE_VAULT_FOLDER = 'big';

/**
 * A sibling note outside {@link PERFORMANCE_VAULT_FOLDER} that must stay visible.
 */
export const PERFORMANCE_VAULT_CONTROL = 'keep-real.md';

/**
 * The folder every note's inbound link points into. Hiding it (in the fast-enable and
 * hide tests) must demote a large set of inbound links to unresolved — the
 * `demoteInboundLinks` path — and restoring it must promote them back. Its notes are
 * the first {@link FILES_PER_FOLDER} the populate spec creates, so the targets exist.
 */
const LINK_TARGET_FOLDER = `${PERFORMANCE_VAULT_FOLDER}/dir-0`;

// Roughly the maintainer's real F:\Obsidian vault size; spread across folders.
// Overridable via AE_PERF_VAULT_SIZE for bounded diagnostic runs (e.g. 20000).
const DEFAULT_PERFORMANCE_VAULT_SIZE = 90_000;
const PERFORMANCE_VAULT_SIZE = Number(process.env['AE_PERF_VAULT_SIZE']) || DEFAULT_PERFORMANCE_VAULT_SIZE;
const FILES_PER_FOLDER = 30;

/**
 * Builds the file map for a large vault, written to disk by `TemporaryVault.populate()`
 * before Obsidian opens it (so its startup scan indexes it in one pass — far
 * faster and more reliable than writing notes after open and forcing a re-scan).
 *
 * Every note carries two `[[...]]` links so the vault is **not link-free**: one to the
 * always-visible control note (a large fan-in that must survive every hide) and one
 * into {@link LINK_TARGET_FOLDER} (`big/dir-0`), so hiding that folder exercises the
 * plugin's inbound-link demotion at scale (and restoring it, the promotion) — the path
 * a link-free vault would never touch.
 *
 * @returns A map of vault-relative note paths to content.
 */
export function generatePerformanceVault(): PopulateFilesParams {
  const files: PopulateFilesParams = { [PERFORMANCE_VAULT_CONTROL]: 'control' };
  let written = 0;
  let folderIndex = 0;
  while (written < PERFORMANCE_VAULT_SIZE) {
    for (let fileIndex = 0; fileIndex < FILES_PER_FOLDER && written < PERFORMANCE_VAULT_SIZE; fileIndex++) {
      const controlLink = `[[${PERFORMANCE_VAULT_CONTROL.replace(/\.md$/, '')}]]`;
      const targetLink = `[[${LINK_TARGET_FOLDER}/file-${String(fileIndex)}]]`;
      files[`${PERFORMANCE_VAULT_FOLDER}/dir-${String(folderIndex)}/file-${String(fileIndex)}.md`] = `${controlLink}\n${targetLink}\n`;
      written++;
    }
    folderIndex++;
  }
  return files;
}
