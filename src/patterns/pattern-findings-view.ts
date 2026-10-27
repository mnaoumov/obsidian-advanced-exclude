import { appendCodeBlock } from '@mnaoumov/obsidian-lib/html-element';
import { debounce } from 'obsidian';

import type { PatternFinding } from './pattern-validation.ts';

import { validatePatterns } from './pattern-validation.ts';

/**
 * How long typing must pause before the findings under a pattern box are re-checked, so they do not flicker on every
 * keystroke.
 */
export const PATTERN_VALIDATION_DELAY_IN_MILLISECONDS = 300;

export interface SourcedPatternFinding extends PatternFinding {
  /**
   * What the line number refers to, such as a profile name. Omitted for the box the findings sit under.
   */
  readonly source?: string;
}

interface AttachPatternValidationParams {
  readonly areDirectivesAllowed: boolean;
  readonly findingsEl: HTMLElement;
  readonly textAreaEl: HTMLTextAreaElement;
}

interface RenderPatternFindingsParams {
  readonly findings: readonly SourcedPatternFinding[];
  readonly findingsEl: HTMLElement;
}

/**
 * Appends {@link message} to {@link parentEl}, with every `` `...` `` span as inline code.
 */
export function appendFindingMessage(parentEl: DocumentFragment | HTMLElement, message: string): void {
  let isCode = false;
  for (const part of message.split('`')) {
    if (isCode) {
      appendCodeBlock(parentEl, part);
    } else if (part !== '') {
      parentEl.appendText(part);
    }
    isCode = !isCode;
  }
}

/**
 * Shows the findings of {@link AttachPatternValidationParams.textAreaEl}'s text in
 * {@link AttachPatternValidationParams.findingsEl} now, and again after each pause in typing. It only reports: the
 * text is saved and applied whatever it finds.
 */
export function attachPatternValidation(params: AttachPatternValidationParams): void {
  const { areDirectivesAllowed, findingsEl, textAreaEl } = params;
  function update(): void {
    renderPatternFindings({ findings: validatePatterns({ areDirectivesAllowed, text: textAreaEl.value }), findingsEl });
  }
  textAreaEl.addEventListener('input', debounce(update, PATTERN_VALIDATION_DELAY_IN_MILLISECONDS, true));
  update();
}

/**
 * Replaces the content of {@link RenderPatternFindingsParams.findingsEl} with one line per finding.
 */
export function renderPatternFindings(params: RenderPatternFindingsParams): void {
  const { findings, findingsEl } = params;
  findingsEl.empty();
  for (const finding of findings) {
    const findingEl = findingsEl.createDiv({ cls: ['advanced-exclude-pattern-finding', `advanced-exclude-pattern-finding-${finding.severity}`] });
    findingEl.appendText(`${finding.source === undefined ? 'Line' : `${finding.source}, line`} ${String(finding.lineNumber)}: `);
    appendFindingMessage(findingEl, finding.message);
  }
}
