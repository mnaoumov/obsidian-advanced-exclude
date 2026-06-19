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

import type { IndexProjectionComponent } from './index-projection-component.ts';

import { RestoreNoticeComponent } from './restore-notice-component.ts';

vi.mock('obsidian-dev-utils/async', () => ({
  invokeAsyncSafelyAfterDelay: vi.fn((fn: () => Promise<void>) => {
    fn().catch(() => undefined);
  })
}));

const showNoticeMock = vi.fn((_message: DocumentFragment | string, _options?: PluginNoticeComponentShowNoticeOptions): void => {
  // Captured via showNoticeMock.mock.calls.
});

interface CreateComponentResult {
  readonly component: RestoreNoticeComponent;
  readonly restoreAll: ReturnType<typeof vi.fn>;
}

function createComponent(hiddenCount: number): CreateComponentResult {
  const restoreAll = vi.fn().mockResolvedValue(undefined);
  const indexProjectionComponent = strictProxy<IndexProjectionComponent>({
    getHiddenCount: vi.fn().mockReturnValue(hiddenCount),
    restoreAll
  });
  const pluginNoticeComponent = strictProxy<PluginNoticeComponent>({ showNotice: showNoticeMock });
  const component = new RestoreNoticeComponent({ indexProjectionComponent, pluginNoticeComponent });
  return { component, restoreAll };
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

  it('should restore inline on unload when the hidden set is small', () => {
    const { component, restoreAll } = createComponent(5);
    component.load();
    component.unload();

    expect(restoreAll).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).not.toHaveBeenCalled();
  });

  it('should show a permanent reload notice on unload when the hidden set is large', () => {
    const { component, restoreAll } = createComponent(2000);
    component.load();
    component.unload();

    expect(restoreAll).not.toHaveBeenCalled();
    expect(showNoticeMock).toHaveBeenCalledTimes(1);
    expect(showNoticeMock).toHaveBeenCalledWith(expect.any(DocumentFragment), { isPermanent: true });

    const fragment = getFragment(showNoticeMock.mock.calls[0]?.[0]);
    expect(fragment.textContent).toContain('The file tree is not fully restored to the original state');
    expect(fragment.textContent).toContain('Alternatively, you can re-enable the plugin');
    expect(fragment.querySelector('button')?.textContent).toBe('Reload');
  });

  it('should do nothing on unload when nothing was hidden', () => {
    const { component, restoreAll } = createComponent(0);
    component.load();
    component.unload();

    expect(restoreAll).not.toHaveBeenCalled();
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
      const { component } = createComponent(2000);
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
