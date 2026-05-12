import {
  describe,
  expect,
  it
} from 'vitest';

import {
  GIT_IGNORE_FILE,
  OBSIDIAN_IGNORE_FILE,
  ROOT_PATH
} from './constants.ts';

describe('constants', () => {
  it('should export ROOT_PATH as /', () => {
    expect(ROOT_PATH).toBe('/');
  });

  it('should export OBSIDIAN_IGNORE_FILE as .obsidianignore', () => {
    expect(OBSIDIAN_IGNORE_FILE).toBe('.obsidianignore');
  });

  it('should export GIT_IGNORE_FILE as .gitignore', () => {
    expect(GIT_IGNORE_FILE).toBe('.gitignore');
  });
});
