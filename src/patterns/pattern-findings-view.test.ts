import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  appendFindingMessage,
  attachPatternValidation,
  PATTERN_VALIDATION_DELAY_IN_MILLISECONDS,
  renderPatternFindings
} from './pattern-findings-view.ts';
import { PatternFindingSeverity } from './pattern-validation.ts';

describe('appendFindingMessage', () => {
  it('should render the spans in backticks as inline code', () => {
    const el = createDiv();

    appendFindingMessage(el, 'Write `\\[` for a `[`.');

    expect(el.innerHTML).toBe(String.raw`Write <strong class="markdown-rendered code"><code>\[</code></strong> for a <strong class="markdown-rendered code"><code>[</code></strong>.`);
  });
});

describe('renderPatternFindings', () => {
  it('should replace the content with one line per finding, colored by severity and labelled by source', () => {
    const el = createDiv({ text: 'stale' });

    renderPatternFindings({
      findings: [
        { lineNumber: 1, message: 'Bad `x`.', severity: PatternFindingSeverity.Error },
        { lineNumber: 3, message: 'Odd.', severity: PatternFindingSeverity.Warning, source: 'Work' }
      ],
      findingsEl: el
    });

    expect([...el.children].map((child) => [child.className, child.textContent])).toStrictEqual([
      ['advanced-exclude-pattern-finding advanced-exclude-pattern-finding-error', 'Line 1: Bad x.'],
      ['advanced-exclude-pattern-finding advanced-exclude-pattern-finding-warning', 'Work, line 3: Odd.']
    ]);
  });
});

describe('attachPatternValidation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show the findings at once, and again once typing pauses', () => {
    const textAreaEl = createEl('textarea');
    textAreaEl.value = '!';
    const findingsEl = createDiv();

    attachPatternValidation({ areDirectivesAllowed: false, findingsEl, textAreaEl });
    expect(findingsEl.textContent).toBe('Line 1: ! needs a pattern after it.');

    textAreaEl.value = 'fine/';
    textAreaEl.dispatchEvent(new Event('input'));
    expect(findingsEl.textContent).toBe('Line 1: ! needs a pattern after it.');

    vi.advanceTimersByTime(PATTERN_VALIDATION_DELAY_IN_MILLISECONDS);
    expect(findingsEl.textContent).toBe('');
  });
});
