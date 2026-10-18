import type {
  App,
  MetadataCache
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { MetadataCacheInitializePatchComponent } from './metadata-cache-initialize-patch-component.ts';

const mockResume = vi.fn();
const mockSuspend = vi.fn((_app: App): () => void => mockResume);

vi.mock('../related-links-batch.ts', () => ({
  suspendRelatedLinksUpdates: (app: App): () => void => mockSuspend(app)
}));

interface Fixture {
  readonly app: App;
  readonly component: MetadataCacheInitializePatchComponent;
  readonly originalInitialize: ReturnType<typeof vi.fn>;
}

interface InitializeGate {
  resolve?: () => void;
}

function createFixture(originalInitialize: ReturnType<typeof vi.fn>): Fixture {
  const metadataCache = castTo<MetadataCache>({ initialize: originalInitialize });
  const app = castTo<App>({ metadataCache });
  const component = new MetadataCacheInitializePatchComponent(app);
  component.load();
  return { app, component, originalInitialize };
}

describe('MetadataCacheInitializePatchComponent', () => {
  beforeEach(() => {
    mockResume.mockClear();
    mockSuspend.mockClear();
  });

  it('suspends related-links updates for the whole initialize and resumes once it settles', async () => {
    const initializeGate: InitializeGate = {};
    const fixture = createFixture(vi.fn(async () => {
      await new Promise<void>((resolve) => {
        initializeGate.resolve = resolve;
      });
    }));

    const initializePromise = fixture.app.metadataCache.initialize();

    expect(fixture.originalInitialize).toHaveBeenCalledOnce();
    expect(mockSuspend).toHaveBeenCalledWith(fixture.app);
    expect(mockResume).not.toHaveBeenCalled();

    initializeGate.resolve?.();
    await initializePromise;

    expect(mockResume).toHaveBeenCalledOnce();
  });

  it('resumes even when initialize fails', async () => {
    const fixture = createFixture(vi.fn().mockRejectedValue(new Error('cache failed')));

    await expect(fixture.app.metadataCache.initialize()).rejects.toThrow('cache failed');

    expect(mockResume).toHaveBeenCalledOnce();
  });

  it('restores the original initialize on unload', async () => {
    const fixture = createFixture(vi.fn().mockResolvedValue(undefined));

    fixture.component.unload();
    await fixture.app.metadataCache.initialize();

    expect(fixture.originalInitialize).toHaveBeenCalledOnce();
    expect(mockSuspend).not.toHaveBeenCalled();
  });
});
