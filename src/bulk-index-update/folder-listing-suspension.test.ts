import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';

import { noopAsync } from '@mnaoumov/typescript-lib/function';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { skipFolderListings } from './folder-listing-suspension.ts';

type ListRecursive = DataAdapterEx['listRecursive'];

class FakeAdapter {
  public readonly listed: string[] = [];

  public async listRecursive(realPath: string): Promise<void> {
    this.listed.push(realPath);
    await noopAsync();
  }
}

function asAdapter(adapter: object): DataAdapterEx {
  return castTo<DataAdapterEx>(adapter);
}

describe('skipFolderListings', () => {
  it('skips only the given folders and lists every other one', async () => {
    const fake = new FakeAdapter();
    const adapter = asAdapter(fake);

    skipFolderListings(adapter, new Set(['big', 'big/inner']));

    await adapter.listRecursive('big');
    await adapter.listRecursive('big/inner');
    await adapter.listRecursive('other');
    expect(fake.listed).toEqual(['other']);
  });

  it('puts the prototype method back on resume', async () => {
    const fake = new FakeAdapter();
    const adapter = asAdapter(fake);

    const resume = skipFolderListings(adapter, new Set(['big']));
    resume();

    expect(Object.hasOwn(fake, 'listRecursive')).toBe(false);
    await adapter.listRecursive('big');
    expect(fake.listed).toEqual(['big']);
  });

  it('puts an own listRecursive back on resume', () => {
    const ownListRecursive = vi.fn<ListRecursive>();
    const adapter = asAdapter({ listRecursive: ownListRecursive });

    const resume = skipFolderListings(adapter, new Set(['big']));
    expect(adapter.listRecursive).not.toBe(ownListRecursive);
    resume();

    expect(adapter.listRecursive).toBe(ownListRecursive);
  });

  it('keeps a listRecursive that something else installed meanwhile', () => {
    const adapter = asAdapter(new FakeAdapter());
    const replacement = vi.fn<ListRecursive>();

    const resume = skipFolderListings(adapter, new Set(['big']));
    adapter.listRecursive = replacement;
    resume();

    expect(adapter.listRecursive).toBe(replacement);
  });

  it('does nothing when there is no folder to skip', () => {
    const fake = new FakeAdapter();

    const resume = skipFolderListings(asAdapter(fake), new Set());
    resume();

    expect(Object.hasOwn(fake, 'listRecursive')).toBe(false);
  });
});
