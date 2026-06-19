import type {
  PluginNoticeComponent,
  PluginNoticeComponentShowNoticeOptions
} from 'obsidian-dev-utils/obsidian/components/plugin-notice-component';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type { IgnorePatternsComponent } from './ignore-patterns-component.ts';

import { RestoreNoticeComponent } from './restore-notice-component.ts';

const showNoticeMock = vi.fn((_message: DocumentFragment | string, _options?: PluginNoticeComponentShowNoticeOptions): void => {
  // Captured via showNoticeMock.mock.calls.
});

function createComponent(hasHiddenPaths: boolean): RestoreNoticeComponent {
  const ignorePatternsComponent = strictProxy<IgnorePatternsComponent>({ hasHiddenPaths });
  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock });
  return new RestoreNoticeComponent({ ignorePatternsComponent, pluginNoticeComponent });
}

function getFragment(message: DocumentFragment | string | undefined): DocumentFragment {
  if (message === undefined || typeof message === 'string') {
    throw new Error('Expected a DocumentFragment message');
  }
  return message;
}

describe('RestoreNoticeComponent', () => {
  beforeEach(() => {
    showNoticeMock.mockClear();
  });

  it('should show a permanent restore notice on unload when paths were hidden', () => {
    const component = createComponent(true);
    component.load();
    component.unload();

    expect(showNoticeMock).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith(expect.any(DocumentFragment), { isPermanent: true });

    const fragment = getFragment(showNoticeMock.mock.calls[0]?.[0]);
    expect(fragment.textContent).toContain('The file tree is not fully restored to the original state');
    expect(fragment.textContent).toContain('Alternatively, you can re-enable the plugin');
    expect(fragment.querySelector('button')?.textContent).toBe('Reload');
  });

  it('should not show a notice on unload when nothing was hidden', () => {
    const component = createComponent(false);
    component.load();
    component.unload();

    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it('should reload the app when the notice Reload button is clicked', () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: reloadSpy },
      writable: true
    });

    try {
      const component = createComponent(true);
      component.load();
      component.unload();

      getFragment(showNoticeMock.mock.calls[0]?.[0]).querySelector('button')?.click();

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
        writable: true
      });
    }
  });
});
