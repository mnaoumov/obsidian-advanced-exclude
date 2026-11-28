import ignore from 'ignore';

/**
 * Where a pattern line, an `Excluded files` entry or a property rule comes from.
 */
export enum PatternLayer {
  ExcludedFiles = 'excluded-files',
  GitIgnore = 'gitignore',
  GlobalPatterns = 'global',
  ImportedFile = 'imported-file',
  LocalPatterns = 'local',
  Profile = 'profile',
  SoftPatterns = 'soft'
}

/**
 * One line of one layer, as the user wrote it.
 */
export interface PatternLineOrigin {
  /**
   * The file an `@import file:` line pasted the line from, for {@link PatternLayer.ImportedFile}.
   */
  readonly filePath?: string;
  readonly layer: PatternLayer;
  /**
   * 1-based, in the text the user edits: the box, the profile, or the file.
   */
  readonly lineNumber: number;
  /**
   * The profile the line belongs to, or that imported its file.
   */
  readonly profileName?: string;
  readonly text: string;
}

/**
 * Why one path has the verdict the patterns give it.
 */
export interface PatternVerdictExplanation {
  /**
   * The line that decided the verdict: the last line matching the path or a folder above it, `!` lines included. `null`
   * when no line matches.
   */
  readonly decidingLine: null | PatternLineOrigin;
  /**
   * The folder whose exclusion the path inherits, when the deciding line matched that folder rather than the path. Git
   * never looks inside an excluded folder, so no `!` line can bring the path back.
   */
  readonly excludedFolderPath: null | string;
  readonly isIgnored: boolean;
  /**
   * Earlier lines matching the path with the opposite effect, which the deciding line overrode, in order.
   */
  readonly overriddenLines: readonly PatternLineOrigin[];
}

/**
 * Matches `gitignore` lines from several layers in order, as one file, and can say which line decided a verdict. The
 * same tester decides the verdict and explains it, so the explanation can never disagree with it.
 */
export class MarkedPatternTester {
  private readonly lines: readonly PatternLineOrigin[];
  private readonly tester: ignore.Ignore;

  public constructor(lines: readonly PatternLineOrigin[]) {
    this.lines = lines;
    this.tester = ignore({ ignoreCase: true }).add(lines.map((line, index) => ({ mark: String(index), pattern: line.text })));
  }

  /**
   * @returns Why the patterns give {@link normalizedPath} its verdict.
   */
  public explain(normalizedPath: string, isFolder: boolean): PatternVerdictExplanation {
    if (normalizedPath === '' || normalizedPath === '/') {
      // The vault root is never excluded, and `ignore` throws on an empty path.
      return { decidingLine: null, excludedFolderPath: null, isIgnored: false, overriddenLines: [] };
    }
    const testedPath = toTestedPath(normalizedPath, isFolder);
    const result = this.tester.test(testedPath);
    // An excluded path always carries the rule that excluded it, or the rule of the folder it inherits from. `ignore`
    // names no rule for a path a `!` line brought back, so that line is found by hand. Last match wins, so a later plain
    // line matching the path would have excluded it: the last matching line here is always a `!` one.
    const decidingIndex = result.ignored ? Number(result.rule?.mark) : this.findLastMatchingNegativeLineIndex(testedPath);
    const excludedFolderPath = result.ignored ? this.findExcludedFolder(normalizedPath) : null;

    const decidingLine = this.lines[decidingIndex] ?? null;
    if (!decidingLine) {
      return { decidingLine: null, excludedFolderPath, isIgnored: result.ignored, overriddenLines: [] };
    }
    const isDecidingNegative = isNegativeLine(decidingLine.text);
    const overriddenLines = this.lines
      .slice(0, decidingIndex)
      .filter((line) => isNegativeLine(line.text) !== isDecidingNegative && doesLineMatch(line.text, testedPath));
    return { decidingLine, excludedFolderPath, isIgnored: result.ignored, overriddenLines };
  }

  /**
   * @returns Whether the patterns exclude {@link normalizedPath}.
   */
  public ignores(normalizedPath: string, isFolder: boolean): boolean {
    return this.tester.ignores(toTestedPath(normalizedPath, isFolder));
  }

  private findExcludedFolder(normalizedPath: string): null | string {
    const segments = normalizedPath.split('/');
    for (let count = 1; count < segments.length; count++) {
      const folderPath = segments.slice(0, count).join('/');
      if (this.tester.ignores(`${folderPath}/`)) {
        return folderPath;
      }
    }
    return null;
  }

  private findLastMatchingNegativeLineIndex(testedPath: string): number {
    let lastIndex = -1;
    for (const [index, line] of this.lines.entries()) {
      if (isNegativeLine(line.text) && doesLineMatch(line.text, testedPath)) {
        lastIndex = index;
      }
    }
    return lastIndex;
  }
}

/**
 * Labels each line of {@link text} with {@link origin}, numbering them from 1.
 *
 * @returns The labelled lines.
 */
export function toPatternLineOrigins(text: string, origin: Pick<PatternLineOrigin, 'filePath' | 'layer' | 'profileName'>): PatternLineOrigin[] {
  return text === '' ? [] : text.split(/\r?\n/).map((lineText, index) => ({ ...origin, lineNumber: index + 1, text: lineText }));
}

/**
 * Whether one line, on its own and with its `!` dropped, matches the path or a folder above it.
 */
function doesLineMatch(lineText: string, testedPath: string): boolean {
  const pattern = isNegativeLine(lineText) ? lineText.slice(1) : lineText;
  return ignore({ ignoreCase: true }).add(pattern).ignores(testedPath);
}

function isNegativeLine(lineText: string): boolean {
  return lineText.startsWith('!');
}

/**
 * A folder is tested in its trailing-slash form only: that is the form gitignore negation re-includes through `!*\/`.
 */
function toTestedPath(normalizedPath: string, isFolder: boolean): string {
  return isFolder ? `${normalizedPath}/` : normalizedPath;
}
