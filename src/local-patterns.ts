import { OBSIDIAN_IGNORE_FILE } from './constants.ts';

const BYTE_ORDER_MARK = '\u{FEFF}';
const CRLF = '\r\n';
const LF = '\n';

/**
 * The comment block a new `.obsidianignore` starts with. The settings tab shows it in place of a missing file, so it is
 * written by the first save and never on load: a vault kept in git or Syncthing gets no file nobody asked for.
 */
export const LOCAL_PATTERNS_HEADER = [
  `# ${OBSIDIAN_IGNORE_FILE}: exclude patterns for this device only, read by the \`Advanced Exclude\` plugin.`,
  '# Obsidian Sync does not carry this file to your other devices; other sync tools (git, Syncthing, ...) may.',
  '# Patterns meant for every device belong in the plugin\'s global patterns setting.',
  '# Pattern syntax: https://git-scm.com/docs/gitignore#_pattern_format',
  ''
].join(LF);

interface FormatLocalPatternsFileParams {
  /**
   * The file's raw content before the save, or `null` when it does not exist yet.
   */
  readonly existingContent: null | string;
  /**
   * Whether this device is Windows, where a new file gets CRLF line endings.
   */
  readonly isWindows: boolean;
  /**
   * The text as edited, with LF line endings.
   */
  readonly text: string;
}

/**
 * Formats the edited text for writing, keeping the line ending and byte order mark the file already has; a new file
 * gets the platform's line ending and no byte order mark.
 */
export function formatLocalPatternsFile(params: FormatLocalPatternsFileParams): string {
  const { existingContent, isWindows, text } = params;
  const lineEnding = existingContent === null ? (isWindows ? CRLF : LF) : (existingContent.includes(CRLF) ? CRLF : LF);
  const byteOrderMark = existingContent?.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  return byteOrderMark + normalizeLocalPatterns(text).split(LF).join(lineEnding);
}

/**
 * Normalizes the file's content for matching and editing: no byte order mark, and LF line endings whatever the file
 * uses, a lone CR included.
 */
export function normalizeLocalPatterns(content: string): string {
  return content.replace(/^\u{FEFF}/u, '').replaceAll(/\r\n?/g, '\n');
}
