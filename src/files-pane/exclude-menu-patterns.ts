/**
 * The `gitignore` lines the Files pane menu writes for the items it was opened on.
 */

export interface AppendPatternLinesResult {
  /**
   * The lines that were not in the text yet, in the order they were appended.
   */
  readonly addedLines: readonly string[];
  readonly text: string;
}

/**
 * One item the Files pane menu was opened on.
 */
export interface ExcludeMenuTarget {
  readonly isFolder: boolean;
  /**
   * The vault path, as `TAbstractFile.path` has it: no leading or trailing `/`.
   */
  readonly path: string;
}

// `\`, `*`, `?` and `[` mean something in a `gitignore` line wherever they sit; `!` and `#` only at its start, which a
// root-anchored line never puts a path character in.
const SPECIAL_CHARACTERS_REG_EXP = /[*?[\\]/g;
const TRAILING_SPACES_REG_EXP = / +$/;

/**
 * Appends {@link lines} to the pattern text {@link text}, one per line, leaving out each line the text already has.
 */
export function appendPatternLines(text: string, lines: readonly string[]): AppendPatternLinesResult {
  const existingLines = new Set(text.split(/\r?\n/));
  const addedLines: string[] = [];
  for (const line of lines) {
    if (existingLines.has(line)) {
      continue;
    }
    existingLines.add(line);
    addedLines.push(line);
  }

  if (addedLines.length === 0) {
    return { addedLines, text };
  }

  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  return {
    addedLines,
    text: `${text}${separator}${addedLines.join('\n')}\n`
  };
}

/**
 * The lines that exclude everything in the folder of {@link targets} except them: `/<folder>/*`, then a `!` line per
 * target. Returns `null` when the targets are not all in one folder.
 */
export function createExcludeEverythingElseLines(targets: readonly ExcludeMenuTarget[]): null | string[] {
  const parentPath = getCommonParentPath(targets);
  if (parentPath === null) {
    return null;
  }
  const folderPrefix = parentPath === '' ? '/' : `/${escapePatternPath(parentPath)}/`;
  return [`${folderPrefix}*`, ...targets.map((target) => `!${createExcludeLine(target)}`)];
}

/**
 * The line that excludes {@link target} and nothing else: its path anchored at the vault root, with a trailing `/`
 * for a folder.
 */
export function createExcludeLine(target: ExcludeMenuTarget): string {
  return `/${escapePatternPath(target.path)}${target.isFolder ? '/' : ''}`;
}

/**
 * Escapes {@link path} so a `gitignore` line matches it literally.
 */
export function escapePatternPath(path: string): string {
  return path
    .replaceAll(SPECIAL_CHARACTERS_REG_EXP, (character) => `\\${character}`)
    .replace(TRAILING_SPACES_REG_EXP, (spaces) => '\\ '.repeat(spaces.length));
}

/**
 * The folder path every one of {@link targets} sits in directly (`''` for the vault root), or `null` when there are
 * none or they sit in different folders.
 */
export function getCommonParentPath(targets: readonly ExcludeMenuTarget[]): null | string {
  let commonParentPath: null | string = null;
  for (const target of targets) {
    const parentPath = getParentPath(target.path);
    if (commonParentPath !== null && commonParentPath !== parentPath) {
      return null;
    }
    commonParentPath = parentPath;
  }
  return commonParentPath;
}

function getParentPath(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex === -1 ? '' : path.slice(0, slashIndex);
}
