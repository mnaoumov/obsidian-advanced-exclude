import type { IgnoreVerdictExplanation } from '../patterns/ignore-patterns-component.ts';
import type { SoftVerdictExplanation } from '../soft-exclude/soft-exclude-patch-component.ts';
import type {
  PatternLineOrigin,
  PatternVerdictExplanation
} from './marked-pattern-tester.ts';

import { OBSIDIAN_IGNORE_FILE } from '../constants.ts';
import { appendFindingMessage } from '../patterns/pattern-findings-view.ts';
import { ExcludeMode } from '../settings/plugin-settings.ts';
import { SoftExcludeFeature } from '../soft-exclude/feature-scoped-app.ts';
import { PatternLayer } from './marked-pattern-tester.ts';

/**
 * Everything that decides whether one path is excluded, and how.
 */
export interface PathExplanation {
  readonly excludeMode: ExcludeMode;
  readonly isFolder: boolean;
  readonly main: IgnoreVerdictExplanation;
  readonly path: string;
  readonly soft: SoftVerdictExplanation;
}

const FEATURE_NAMES: Record<SoftExcludeFeature, string> = {
  [SoftExcludeFeature.Graph]: 'graph',
  [SoftExcludeFeature.Other]: 'other features (quick switcher, link suggestions, Bases, the tag pane)',
  [SoftExcludeFeature.Search]: 'search',
  [SoftExcludeFeature.UnlinkedMentions]: 'unlinked mentions'
};

type LayerDescriber = (line: PatternLineOrigin) => string;

/**
 * Describes {@link explanation} as sentences, each a `` `code` ``-marked string: the verdict first, then the line that
 * decided it, the lines it overrode, and whatever else applies.
 *
 * @returns The sentences, in order.
 */
export function describePathExplanation(explanation: PathExplanation): string[] {
  const { main, soft } = explanation;
  const sentences = [describeVerdict(explanation), ...describePatternVerdict(main.patterns, 'Patterns')];

  if (main.excludedFilesEntry) {
    sentences.push(`Obsidian's \`Excluded files\` exclude it: ${describeLine(main.excludedFilesEntry)}.`);
  }
  if (soft.softPatterns) {
    sentences.push(...describePatternVerdict(soft.softPatterns, 'Soft patterns'));
  }
  if (soft.propertyRule) {
    sentences.push(
      `Its properties match \`${soft.propertyRule.text.trim()}\`, line ${String(soft.propertyRule.lineNumber)} of \`Exclude notes by property\`.`
    );
  }
  return sentences;
}

/**
 * Renders {@link explanation} into {@link containerEl}, one paragraph per sentence of {@link describePathExplanation}.
 */
export function renderPathExplanation(containerEl: HTMLElement, explanation: PathExplanation): void {
  containerEl.empty();
  for (const sentence of describePathExplanation(explanation)) {
    appendFindingMessage(containerEl.createDiv({ cls: 'advanced-exclude-explanation-line' }), sentence);
  }
}

const LAYER_DESCRIBERS: Record<PatternLayer, LayerDescriber> = {
  [PatternLayer.ExcludedFiles]: () => 'Obsidian\'s `Excluded files`',
  [PatternLayer.GitIgnore]: () => '`.gitignore`',
  [PatternLayer.GlobalPatterns]: () => 'the global patterns',
  [PatternLayer.ImportedFile]: (line) => `\`${line.filePath ?? ''}\`, which the profile \`${line.profileName ?? ''}\` imports`,
  [PatternLayer.LocalPatterns]: () => `\`${OBSIDIAN_IGNORE_FILE}\``,
  [PatternLayer.Profile]: (line) => `the profile \`${line.profileName ?? ''}\``,
  [PatternLayer.SoftPatterns]: () => 'the soft patterns'
};

const HIDDEN_FROM_BY_MODE: Record<ExcludeMode.FilesPane | ExcludeMode.Full, string> = {
  [ExcludeMode.FilesPane]: 'hidden from the Files pane',
  [ExcludeMode.Full]: 'hidden from the whole app'
};

function describeLayer(line: PatternLineOrigin): string {
  return LAYER_DESCRIBERS[line.layer](line);
}

function describeLine(line: PatternLineOrigin): string {
  return `\`${line.text}\`, line ${String(line.lineNumber)} of ${describeLayer(line)}`;
}

function describePatternVerdict(verdict: PatternVerdictExplanation, listName: string): string[] {
  const { decidingLine, excludedFolderPath, isIgnored, overriddenLines } = verdict;
  if (!decidingLine) {
    return isIgnored ? [] : [`${listName}: no line matches it.`];
  }
  const sentences = [
    isIgnored
      ? `${listName}: excluded by ${describeLine(decidingLine)}.`
      : `${listName}: brought back by ${describeLine(decidingLine)}.`
  ];
  if (excludedFolderPath !== null) {
    sentences.push(
      `That line excludes its folder \`${excludedFolderPath}\`, and nothing inside an excluded folder can be brought back with a \`!\` line; bring the folder back first.`
    );
  }
  for (const line of overriddenLines) {
    sentences.push(`It overrides ${describeLine(line)}.`);
  }
  return sentences;
}

function describeSoftFeatures(soft: SoftVerdictExplanation): string {
  return soft.excludedFeatures.length === 0 ? 'nothing: every `Soft: exclude from ...` toggle is off' : soft.excludedFeatures.map((feature) => FEATURE_NAMES[feature]).join(', ');
}

function describeVerdict(explanation: PathExplanation): string {
  const { excludeMode, isFolder, main, path, soft } = explanation;
  const subject = `${isFolder ? 'The folder' : 'The file'} \`${path}\``;
  if (main.isIgnored) {
    return excludeMode === ExcludeMode.Soft
      ? `${subject} is soft-excluded from ${describeSoftFeatures(soft)}.`
      : `${subject} is excluded: ${HIDDEN_FROM_BY_MODE[excludeMode]}.`;
  }
  return soft.softPatterns?.isIgnored === true || soft.propertyRule !== null ? `${subject} is soft-excluded from ${describeSoftFeatures(soft)}.` : `${subject} is not excluded.`;
}
