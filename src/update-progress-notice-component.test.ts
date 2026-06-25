import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeOptions
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { Notice } from 'obsidian';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { UpdateProgressNoticeComponent } from './update-progress-notice-component.ts';

const showNoticeMock = vi.fn((message: DocumentFragment | string, _options?: PluginNoticeComponentShowNoticeOptions): Notice => new Notice(message, 0));

function createComponent(): UpdateProgressNoticeComponent {
  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock });
  return new UpdateProgressNoticeComponent(pluginNoticeComponent);
}

describe('UpdateProgressNoticeComponent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('start shows a notice whose fragment carries the message and a progress bar', () => {
    const createFragmentSpy = vi.spyOn(window, 'createFragment');
    const component = createComponent();

    component.start('Working…');

    const fragment = getFragment(createFragmentSpy.mock.results[0]?.value);
    expect(fragment.textContent).toContain('Working…');
    expect(fragment.querySelector('progress')).not.toBeNull();
  });

  it('report updates the progress bar value and max', () => {
    const createFragmentSpy = vi.spyOn(window, 'createFragment');
    const component = createComponent();
    component.start('Working…');
    const progressEl = getFragment(createFragmentSpy.mock.results[0]?.value).querySelector('progress');

    component.report(3, 10);

    expect(progressEl?.value).toBe(3);
    expect(progressEl?.max).toBe(10);
  });

  it('report is a no-op when no notice is showing', () => {
    const component = createComponent();

    expect(() => {
      component.report(1, 2);
    }).not.toThrow();
  });

  it('finish hides the notice', () => {
    const hideSpy = vi.spyOn(Notice.prototype, 'hide');
    const component = createComponent();
    component.start('Working…');

    component.finish();

    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  it('start replaces an already-showing notice', () => {
    const hideSpy = vi.spyOn(Notice.prototype, 'hide');
    const component = createComponent();
    component.start('First');

    component.start('Second');

    expect(hideSpy).toHaveBeenCalledTimes(1);
  });

  it('hides the notice on unload', () => {
    const hideSpy = vi.spyOn(Notice.prototype, 'hide');
    const component = createComponent();
    component.load();
    component.start('Working…');

    component.unload();

    expect(hideSpy).toHaveBeenCalledTimes(1);
  });
});

function getFragment(value: unknown): DocumentFragment {
  if (!(value instanceof DocumentFragment)) {
    throw new Error('Expected createFragment to return a DocumentFragment');
  }
  return value;
}
