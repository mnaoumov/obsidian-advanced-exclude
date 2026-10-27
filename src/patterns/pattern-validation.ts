/**
 * @file
 *
 * Checks pattern text line by line for mistakes the matcher would accept silently. Each check follows what the
 * `ignore` matcher actually does with the line, so an error is a line that matches nothing, and a warning is a line
 * that matches something other than what it most likely means. Nothing here reads the vault: it runs on every
 * keystroke.
 */

export enum PatternFindingSeverity {
  Error = 'error',
  Warning = 'warning'
}

export interface PatternFinding extends LineFinding {
  /**
   * 1-based line number in the checked text.
   */
  readonly lineNumber: number;
}

interface LineFinding {
  readonly message: string;
  readonly severity: PatternFindingSeverity;
}

interface ValidatePatternsParams {
  /**
   * Whether the text is a profile's, where a line starting with `@` is a directive and `\@` starts a pattern that
   * begins with `@`. In the global patterns and in `.obsidianignore` every line is a pattern.
   */
  readonly areDirectivesAllowed: boolean;
  readonly text: string;
}

// The POSIX classes `ignore` knows. Any other name makes the whole line match nothing.
const POSIX_CLASS_NAMES = new Set(['alnum', 'alpha', 'blank', 'cntrl', 'digit', 'graph', 'lower', 'print', 'punct', 'space', 'upper', 'xdigit']);
const DIRECTIVE_REG_EXP = /^@(?:import|reset)(?:\s|$)/;
const WINDOWS_DRIVE_REG_EXP = /^[A-Za-z]:[\\/]/;
// A `/.../` line with something only a regular expression would say inside: Obsidian's `Excluded files` syntax. `.*`,
// `(`, `+` and `$` are left out on purpose: `/.*/`, `/Notes (old)/`, `/C++/` and `/$RECYCLE.BIN/` are real patterns.
const REG_EXP_LIKE_REG_EXP = /^\/(?:\^.*|.*(?:\.\+|\\[dsw]|\|).*|.*\$)\/$/i;
const BACKSLASH_BEFORE_NAME_CHARACTER_REG_EXP = /^[\p{L}\p{N}]$/u;
// A line that ends with one space, escaped by an odd run of backslashes: the one trailing space gitignore keeps.
const ESCAPED_LAST_SPACE_REG_EXP = /(?:^|[^\\])(?:\\\\)*\\ $/;
const ESCAPE_SEQUENCE_LENGTH = 2;
const POSIX_CLASS_OPENER = '[:';

interface BracketScanResult {
  /**
   * The index of the closing `]`, or `null` when the expression never closes.
   */
  readonly end: null | number;
  readonly findings: LineFinding[];
}

interface PosixClassScanResult {
  readonly index: number;
  readonly previous: string;
}

/**
 * Checks every line of {@link ValidatePatternsParams.text}.
 *
 * @returns The findings, in line order.
 */
export function validatePatterns(params: ValidatePatternsParams): PatternFinding[] {
  const findings: PatternFinding[] = [];
  const lines = params.text === '' ? [] : params.text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const { message, severity } of validateLine(line, params.areDirectivesAllowed)) {
      findings.push({ lineNumber: index + 1, message, severity });
    }
  }
  return findings;
}

function error(message: string): LineFinding {
  return { message, severity: PatternFindingSeverity.Error };
}

/**
 * Scans the bracket expression that opens at `pattern[start]`, the way `ignore` (and git's `wildmatch.c`) does: the
 * first member is taken unconditionally, so a leading `]` is a member.
 */
function scanBracket(pattern: string, start: number): BracketScanResult {
  const findings: LineFinding[] = [];
  let index = start + 1;
  if (pattern[index] === '!' || pattern[index] === '^') {
    index++;
  }

  let previous = '';
  for (;;) {
    const char = pattern[index];
    if (char === undefined) {
      return { end: null, findings };
    }

    if (char === '\\') {
      const escaped = pattern[index + 1];
      if (escaped === undefined) {
        return { end: null, findings };
      }
      previous = escaped;
      index++;
    } else if (char === '-' && previous !== '' && index + 1 < pattern.length && pattern[index + 1] !== ']') {
      index++;
      if (pattern[index] === '\\') {
        index++;
      }
      const to = pattern[index];
      if (to === undefined) {
        return { end: null, findings };
      }
      if (previous > to) {
        findings.push(warning(`The range \`${previous}-${to}\` runs backwards, so it matches only \`${previous}\`.`));
      }
      previous = '';
    } else if (pattern.startsWith(POSIX_CLASS_OPENER, index)) {
      const posixClass = scanPosixClass(pattern, index, findings);
      if (!posixClass) {
        return { end: null, findings };
      }
      ({ index, previous } = posixClass);
    } else {
      previous = char;
    }

    index++;
    if (pattern[index] === ']') {
      return { end: index, findings };
    }
  }
}

/**
 * Scans the `[:` at `pattern[start]` inside a bracket expression: a POSIX class when a `:]` closes it, a plain `[`
 * member otherwise.
 *
 * @returns Where the scan goes on from and the member a `-` could start a range from, or `null` when no `]` follows
 * at all, which leaves the whole bracket expression unclosed.
 */
function scanPosixClass(pattern: string, start: number, findings: LineFinding[]): null | PosixClassScanResult {
  const nameStart = start + POSIX_CLASS_OPENER.length;
  const end = pattern.indexOf(']', nameStart);
  if (end === -1) {
    return null;
  }
  if (end === nameStart || pattern[end - 1] !== ':') {
    return { index: start, previous: '[' };
  }
  const name = pattern.slice(nameStart, end - 1);
  if (!POSIX_CLASS_NAMES.has(name)) {
    findings.push(error(`Unknown character class \`[:${name}:]\`, so this line matches nothing.`));
  }
  return { index: end, previous: '' };
}

/**
 * The checks on a pattern's characters: brackets, backslashes, trailing spaces.
 */
function validateCharacters(pattern: string, columnOffset: number): LineFinding[] {
  const findings: LineFinding[] = [];
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '\\') {
      const escaped = pattern[index + 1];
      if (escaped === undefined) {
        findings.push(error('A line cannot end with a single `\\`, so this line matches nothing. Write `\\\\` for a backslash.'));
        return findings;
      }
      if (BACKSLASH_BEFORE_NAME_CHARACTER_REG_EXP.test(escaped)) {
        findings.push(warning(`\`\\${escaped}\` is just \`${escaped}\`: a backslash only escapes the next character. Write \`/\` between folders.`));
      }
      index += ESCAPE_SEQUENCE_LENGTH;
      continue;
    }

    if (char === '[') {
      const { end, findings: bracketFindings } = scanBracket(pattern, index);
      findings.push(...bracketFindings);
      if (end === null) {
        findings.push(error(`The \`[\` at column ${String(columnOffset + index + 1)} is never closed, so this line matches nothing. Write \`\\[\` for a bracket.`));
        return findings;
      }
      index = end + 1;
      continue;
    }

    index++;
  }

  if (pattern.endsWith(' ') && !ESCAPED_LAST_SPACE_REG_EXP.test(pattern)) {
    findings.push(warning('Trailing spaces are dropped. Write `\\ ` for a space that is part of the name.'));
  }

  return findings;
}

function validateLine(line: string, areDirectivesAllowed: boolean): LineFinding[] {
  if (line.trim() === '' || line.startsWith('#')) {
    return [];
  }

  let pattern = line;
  if (areDirectivesAllowed) {
    // Directives are checked by the profile expansion, which knows the other profiles.
    if (line.startsWith('@')) {
      return [];
    }
    // The expansion turns `\@` into `@` before the matcher sees the line.
    if (line.startsWith(String.raw`\@`)) {
      pattern = line.slice(1);
    }
  } else if (DIRECTIVE_REG_EXP.test(line)) {
    return [warning('`@import` and `@reset` work only in a profile. Here this line is a pattern for a name that starts with `@`.')];
  }

  if (pattern === '!') {
    return [error('`!` needs a pattern after it.')];
  }

  // A column is counted in the line as typed, the `\` of a `\@` included.
  const findings = validateCharacters(pattern, line.length - pattern.length);
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern;

  if (WINDOWS_DRIVE_REG_EXP.test(body)) {
    findings.push(warning('This looks like a full path on disk. Patterns are relative to the vault root: write `/folder` for a folder at the root.'));
  } else if (REG_EXP_LIKE_REG_EXP.test(body)) {
    findings.push(warning('This looks like a regular expression, as in Obsidian\'s `Excluded files`. Here it is a gitignore pattern for a folder at the vault root.'));
  }

  if (body.split('/').some((segment) => segment === '.' || segment === '..')) {
    findings.push(error('A `.` or `..` path segment never matches: vault paths have none. Write `/folder` for a folder at the root.'));
  }

  return findings;
}

function warning(message: string): LineFinding {
  return { message, severity: PatternFindingSeverity.Warning };
}
