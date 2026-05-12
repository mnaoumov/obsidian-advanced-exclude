import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import Plugin from './main.ts';
import { Plugin as PluginClass } from './plugin.ts';

vi.mock('./styles/main.scss');

describe('main', () => {
  it('should export Plugin as default export', () => {
    expect(Plugin).toBe(PluginClass);
  });
});
