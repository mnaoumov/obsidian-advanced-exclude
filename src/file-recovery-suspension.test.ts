import type { EventsEntry } from '@obsidian-typings/obsidian-public-latest';
import type { App } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { suspendFileRecoveryCreateSnapshots } from './file-recovery-suspension.ts';

type Listener = EventsEntry['fn'];

function createApp(fileRecovery: null | object, listeners: Record<string, EventsEntry[]>): App {
  return strictProxy<App>({
    internalPlugins: {
      getEnabledPluginById: castTo<App['internalPlugins']['getEnabledPluginById']>((id: string): null | object => id === 'file-recovery' ? fileRecovery : null)
    },
    vault: {
      _: nullPrototype(listeners)
    }
  });
}

function createEntry(name: string, context: object): EventsEntry {
  // eslint-disable-next-line unicorn/name-replacements -- `ctx` and `fn` are the field names of Obsidian's `EventsEntry`.
  return nullPrototype(castTo<EventsEntry>({ ctx: context, fn: vi.fn(), name }));
}

function getListener(entry: EventsEntry): Listener {
  return entry.fn;
}

// Null-prototype objects: `strictProxy` wraps plain objects, and a wrapped `ctx` or listener list
// would no longer be the very object the code under test compares and mutates.
function nullPrototype<T extends object>(value: T): T {
  return Object.assign(castTo<T>(Object.create(null)), value);
}

describe('suspendFileRecoveryCreateSnapshots', () => {
  it('mutes only the File recovery create listener and puts the same function back on resume', () => {
    const fileRecovery = nullPrototype({});
    const createEntryOfFileRecovery = createEntry('create', fileRecovery);
    const createEntryOfOther = createEntry('create', nullPrototype({}));
    const modifyEntryOfFileRecovery = createEntry('modify', fileRecovery);
    const originalCreateListener = getListener(createEntryOfFileRecovery);
    const originalOtherListener = getListener(createEntryOfOther);
    const originalModifyListener = getListener(modifyEntryOfFileRecovery);
    const app = createApp(fileRecovery, {
      create: [createEntryOfFileRecovery, createEntryOfOther],
      modify: [modifyEntryOfFileRecovery]
    });

    const resume = suspendFileRecoveryCreateSnapshots(app);

    expect(getListener(createEntryOfFileRecovery)).not.toBe(originalCreateListener);
    getListener(createEntryOfFileRecovery)();
    expect(originalCreateListener).not.toHaveBeenCalled();
    expect(getListener(createEntryOfOther)).toBe(originalOtherListener);
    expect(getListener(modifyEntryOfFileRecovery)).toBe(originalModifyListener);

    resume();

    expect(getListener(createEntryOfFileRecovery)).toBe(originalCreateListener);
  });

  it('does nothing when File recovery is disabled', () => {
    const entry = createEntry('create', nullPrototype({}));
    const originalListener = getListener(entry);
    const app = createApp(null, { create: [entry] });

    const resume = suspendFileRecoveryCreateSnapshots(app);
    resume();

    expect(getListener(entry)).toBe(originalListener);
  });

  it('copes with no create listeners at all', () => {
    const app = createApp(nullPrototype({}), {});

    const resume = suspendFileRecoveryCreateSnapshots(app);

    expect(() => {
      resume();
    }).not.toThrow();
  });

  it('leaves a listener alone on resume when something else replaced it meanwhile', () => {
    const fileRecovery = nullPrototype({});
    const entry = createEntry('create', fileRecovery);
    const app = createApp(fileRecovery, { create: [entry] });
    const resume = suspendFileRecoveryCreateSnapshots(app);
    const replacement = vi.fn();
    // eslint-disable-next-line unicorn/name-replacements -- `fn` is the field name of Obsidian's `EventsEntry`.
    Object.assign(entry, { fn: replacement });

    resume();

    expect(getListener(entry)).toBe(replacement);
  });
});
