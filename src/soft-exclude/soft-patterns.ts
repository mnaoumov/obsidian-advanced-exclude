import ignore from 'ignore';

import type { PluginSettings } from '../settings/plugin-settings.ts';

import { ExcludeMode } from '../settings/plugin-settings.ts';

/**
 * The settings that decide whether anything is soft-excluded.
 */
export interface SoftExcludeActivitySettings {
  readonly effectiveSettings: Pick<PluginSettings, 'excludeMode'>;
  readonly settings: Pick<PluginSettings, 'softIgnorePatterns'>;
}

/**
 * Matches the `Soft patterns` setting, which soft-excludes in every exclude mode.
 */
export class SoftPatternsTester {
  public readonly hasPatterns: boolean;
  public readonly text: string;
  private readonly tester: ignore.Ignore;

  public constructor(text: string) {
    this.text = text;
    this.hasPatterns = hasSoftPatterns(text);
    this.tester = ignore({ ignoreCase: true }).add(text.split('\n'));
  }

  /**
   * A folder is tested in its trailing-slash form, as the main patterns test it, so a whitelist idiom behaves the same
   * in both lists.
   *
   * @returns Whether the patterns soft-exclude the path.
   */
  public isIgnored(normalizedPath: string, isFolder: boolean): boolean {
    if (!this.hasPatterns || normalizedPath === '' || normalizedPath === '/') {
      return false;
    }
    return this.tester.ignores(isFolder ? `${normalizedPath}/` : normalizedPath);
  }
}

/**
 * @returns Whether the text holds a pattern: a line that is neither blank nor a `#` comment.
 */
export function hasSoftPatterns(text: string): boolean {
  return text.split('\n').some((line) => {
    const trimmedLine = line.trim();
    return trimmedLine !== '' && !trimmedLine.startsWith('#');
  });
}

/**
 * Soft exclusion is at work in the `Soft` exclude mode, where it covers every pattern, and in any other mode while the
 * `Soft patterns` setting holds a pattern.
 *
 * @returns Whether anything can be soft-excluded now.
 */
export function isSoftExcludeActive(params: SoftExcludeActivitySettings): boolean {
  return params.effectiveSettings.excludeMode === ExcludeMode.Soft || hasSoftPatterns(params.settings.softIgnorePatterns);
}
