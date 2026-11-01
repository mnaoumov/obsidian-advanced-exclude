import type { App } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { AppHolder } from './feature-scoped-app.ts';

import {
  callWithScopedApp,
  createFeatureScopedApp
} from './feature-scoped-app.ts';

class FakeMetadataCache {
  public resolvedLinks = { 'a.md': {} };

  public getCachedFiles(): string[] {
    return Object.keys(this.resolvedLinks);
  }

  public isUserIgnored(_path: string): boolean {
    return false;
  }
}

class FakeApp {
  public metadataCache = new FakeMetadataCache();
  public vault = { name: 'vault' };

  public getAppId(): string {
    return this.vault.name;
  }
}

describe('createFeatureScopedApp', () => {
  it('answers isUserIgnored with the given function and reads everything else through', () => {
    const app = new FakeApp();
    const isUserIgnored = vi.fn((path: string) => path === 'hidden.md');
    const scopedApp = createFeatureScopedApp(castTo<App>(app), isUserIgnored);

    expect(scopedApp.metadataCache.isUserIgnored('hidden.md')).toBe(true);
    expect(scopedApp.metadataCache.isUserIgnored('a.md')).toBe(false);
    expect(isUserIgnored).toHaveBeenCalledTimes(2);
    expect(castTo<FakeMetadataCache>(scopedApp.metadataCache).getCachedFiles()).toEqual(['a.md']);
    expect(scopedApp.metadataCache.resolvedLinks).toBe(app.metadataCache.resolvedLinks);
    expect(scopedApp.vault).toBe(app.vault);
    expect(castTo<FakeApp>(scopedApp).getAppId()).toBe('vault');
  });

  it('leaves the real objects untouched', () => {
    const app = new FakeApp();
    createFeatureScopedApp(castTo<App>(app), () => true);

    expect(app.metadataCache.isUserIgnored('a.md')).toBe(false);
  });
});

describe('callWithScopedApp', () => {
  it('swaps an own app property for the call and restores it', () => {
    const app = castTo<App>({ name: 'real' });
    const scopedApp = castTo<App>({ name: 'scoped' });
    const holder: AppHolder = { app };

    const seen = callWithScopedApp(holder, scopedApp, () => holder.app);

    expect(seen).toBe(scopedApp);
    expect(holder.app).toBe(app);
  });

  it('restores the app when the call throws', () => {
    const app = castTo<App>({ name: 'real' });
    const holder: AppHolder = { app };

    expect(() =>
      callWithScopedApp(holder, castTo<App>({}), () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(holder.app).toBe(app);
  });

  it('leaves an app that is not an own writable property alone', () => {
    const app = castTo<App>({ name: 'real' });
    const holder = castTo<AppHolder>(Object.create({ app }));
    const readOnlyHolder = castTo<AppHolder>({});
    Object.defineProperty(readOnlyHolder, 'app', { value: app, writable: false });

    expect(callWithScopedApp(holder, castTo<App>({}), () => holder.app)).toBe(app);
    expect(callWithScopedApp(readOnlyHolder, castTo<App>({}), () => readOnlyHolder.app)).toBe(app);
  });
});
