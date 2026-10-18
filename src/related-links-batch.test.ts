import type {
  App,
  MetadataCache,
  TFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  suspendRelatedLinksUpdates,
  updateRelatedLinksBatched
} from './related-links-batch.ts';

interface Fixture {
  readonly app: App;
  readonly originalUpdateRelatedLinks: ReturnType<typeof vi.fn>;
  readonly queueFileForLinkResolution: ReturnType<typeof vi.fn>;
}

interface PathLike {
  readonly path: string;
}

function createFixture(): Fixture {
  const files = new Map<string, TFile>();
  for (const path of ['by-resolved.md', 'by-unresolved.md', 'by-extension.md', 'unrelated.md', 'no-links.md']) {
    files.set(path, strictProxy<TFile>({ path }));
  }
  const queueFileForLinkResolution = vi.fn();
  const originalUpdateRelatedLinks = vi.fn();
  const metadataCachePrototype = { updateRelatedLinks: originalUpdateRelatedLinks };
  const metadataCache = castTo<MetadataCache>(Object.assign(Object.create(metadataCachePrototype), {
    getCachedFiles: (): string[] => [...files.keys(), 'gone.md'],
    queueFileForLinkResolution,
    resolvedLinks: {
      'by-resolved.md': { 'Folder/Target.md': 1 },
      'gone.md': { 'target.md': 1 },
      'unrelated.md': { 'other.md': 1 }
    },
    unresolvedLinks: {
      'by-extension.md': { 'Folder/target': 1 },
      'by-unresolved.md': { 'TARGET.md': 1 },
      'unrelated.md': { missing: 1 }
    }
  }));
  const app = strictProxy<App>({
    metadataCache,
    vault: {
      getFileByPath: (path: string): null | TFile => files.get(path) ?? null
    }
  });
  return { app, originalUpdateRelatedLinks, queueFileForLinkResolution };
}

function queuedPaths(fixture: Fixture): string[] {
  return fixture.queueFileForLinkResolution.mock.calls.map(([file]) => castTo<PathLike>(file).path).sort();
}

describe('updateRelatedLinksBatched', () => {
  it('queues every file that links to one of the names, matching basenames case-insensitively', () => {
    const fixture = createFixture();

    updateRelatedLinksBatched(fixture.app, ['target.md']);

    // `gone.md` matches too but has no file any more, so it is skipped.
    expect(queuedPaths(fixture)).toEqual(['by-extension.md', 'by-resolved.md', 'by-unresolved.md']);
  });

  it('matches a non-markdown name only with its extension', () => {
    const fixture = createFixture();

    updateRelatedLinksBatched(fixture.app, ['target']);

    expect(queuedPaths(fixture)).toEqual(['by-extension.md']);
  });
});

describe('suspendRelatedLinksUpdates', () => {
  it('collects the calls made while suspended and replays them as one pass on resume', () => {
    const fixture = createFixture();
    const resume = suspendRelatedLinksUpdates(fixture.app);

    fixture.app.metadataCache.updateRelatedLinks(['target.md']);
    fixture.app.metadataCache.updateRelatedLinks(['other.md']);
    expect(fixture.queueFileForLinkResolution).not.toHaveBeenCalled();

    resume();
    expect(queuedPaths(fixture)).toEqual(['by-extension.md', 'by-resolved.md', 'by-unresolved.md', 'unrelated.md']);
    expect(fixture.originalUpdateRelatedLinks).not.toHaveBeenCalled();
    // The inherited original is back in place.
    expect(Object.hasOwn(fixture.app.metadataCache, 'updateRelatedLinks')).toBe(false);
  });

  it('does nothing on resume when nothing was collected, and resumes only once', () => {
    const fixture = createFixture();
    const resume = suspendRelatedLinksUpdates(fixture.app);

    resume();
    resume();
    expect(fixture.queueFileForLinkResolution).not.toHaveBeenCalled();
  });

  it('restores an original that was an own property', () => {
    const fixture = createFixture();
    const ownUpdateRelatedLinks = vi.fn();
    fixture.app.metadataCache.updateRelatedLinks = ownUpdateRelatedLinks;
    const resume = suspendRelatedLinksUpdates(fixture.app);

    resume();
    expect(fixture.app.metadataCache.updateRelatedLinks).toBe(ownUpdateRelatedLinks);
  });

  it('leaves a patch layered on top in place and forwards its later calls to the original', () => {
    const fixture = createFixture();
    const resume = suspendRelatedLinksUpdates(fixture.app);
    const suspendedUpdateRelatedLinks = fixture.app.metadataCache.updateRelatedLinks;
    const layeredUpdateRelatedLinks = vi.fn((fileNames: string[]) => {
      suspendedUpdateRelatedLinks.call(fixture.app.metadataCache, fileNames);
    });
    fixture.app.metadataCache.updateRelatedLinks = layeredUpdateRelatedLinks;

    resume();
    expect(fixture.app.metadataCache.updateRelatedLinks).toBe(layeredUpdateRelatedLinks);
    fixture.app.metadataCache.updateRelatedLinks(['target.md']);
    expect(fixture.originalUpdateRelatedLinks).toHaveBeenCalledExactlyOnceWith(['target.md']);
  });
});
