import type { App } from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { ViewType } from '@obsidian-typings/obsidian-public-latest/implementations';
import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { refreshSearchViews } from './refresh-link-views.ts';

describe('refreshSearchViews', () => {
  it('re-runs the query of every open search view and skips a deferred one', () => {
    const startSearch = vi.fn();
    const getLeavesOfType = vi.fn().mockReturnValue([{ view: { startSearch } }, { view: {} }]);
    const app = castTo<App>({ workspace: { getLeavesOfType } });

    refreshSearchViews(app);

    expect(getLeavesOfType).toHaveBeenCalledWith(ViewType.Search);
    expect(startSearch).toHaveBeenCalledOnce();
  });
});
