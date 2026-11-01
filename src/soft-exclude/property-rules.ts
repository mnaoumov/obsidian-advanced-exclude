/**
 * One line of the `Exclude notes by property` setting: a note is excluded when its property {@link key} has
 * {@link value}, or any non-empty value when {@link value} is `null`.
 */
export interface PropertyRule {
  /**
   * The property name, lower-cased: Obsidian treats property names case-insensitively.
   */
  readonly key: string;
  /**
   * The value to match, lower-cased, or `null` for any non-empty value.
   */
  readonly value: null | string;
}

/**
 * Whether {@link frontmatter} matches any of {@link rules}. A list property matches when any of its items does; values
 * are compared as text, case-insensitively, so `draft: true` matches both `true` and `"True"`.
 */
export function doesMatchPropertyRules(frontmatter: Readonly<Record<string, unknown>> | undefined, rules: readonly PropertyRule[]): boolean {
  if (!frontmatter || rules.length === 0) {
    return false;
  }

  const valuesByKey = new Map<string>();
  for (const [key, value] of Object.entries(frontmatter)) {
    valuesByKey.set(key.toLowerCase(), value);
  }

  return rules.some((rule) => {
    if (!valuesByKey.has(rule.key)) {
      return false;
    }
    const items = toItems(valuesByKey.get(rule.key));
    return rule.value === null ? items.length > 0 : items.includes(rule.value);
  });
}

/**
 * Parses the `Exclude notes by property` setting: one rule per line, `key: value` or `key` alone. Empty lines and lines
 * starting with `#` are skipped, and quotes around a value are dropped.
 */
export function parsePropertyRules(text: string): PropertyRule[] {
  const rules: PropertyRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const colonIndex = line.indexOf(':');
    const key = (colonIndex === -1 ? line : line.slice(0, colonIndex)).trim().toLowerCase();
    if (key === '') {
      continue;
    }
    const value = colonIndex === -1 ? '' : unquote(line.slice(colonIndex + 1).trim());
    rules.push({ key, value: value === '' ? null : value.toLowerCase() });
  }
  return rules;
}

function toItems(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const items: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      continue;
    }
    const text = String(item).trim().toLowerCase();
    if (text !== '') {
      items.push(text);
    }
  }
  return items;
}

function unquote(value: string): string {
  const QUOTED_VALUE_MIN_LENGTH = 2;
  if (value.length >= QUOTED_VALUE_MIN_LENGTH) {
    const first = value.at(0);
    if ((first === '"' || first === '\'') && value.endsWith(first)) {
      return value.slice(1, -1).trim();
    }
  }
  return value;
}
