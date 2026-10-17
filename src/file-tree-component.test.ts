import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  EventRef,
  TAbstractFile
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { strictProxy } from '@mnaoumov/typescript-test-toolkit/strict-proxy';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { FileTreeComponent } from './file-tree-component.ts';

type FileItem = FileExplorerView['fileItems'][string];

interface MockFileExplorerView {
  fileItems: FileExplorerView['fileItems'];
  onCreate: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
}

interface MockLeaf {
  readonly view: object;
}

interface SetupResult {
  readonly app: App;
  readonly component: FileTreeComponent;
  readonly fireLayoutChange: () => void;
  readonly fireLayoutReady: () => void;
  readonly leaves: MockLeaf[];
  readonly onFileExplorerViewBuilt: ReturnType<typeof vi.fn>;
}

function createMockFileExplorerView(overrides: Partial<MockFileExplorerView> = {}): MockFileExplorerView {
  return {
    fileItems: {},
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides
  };
}

function setup(fileExplorerView?: object): SetupResult {
  const leaves: MockLeaf[] = fileExplorerView ? [{ view: fileExplorerView }] : [];
  let layoutChangeCallback: (() => void) | undefined;
  let layoutReadyCallback: (() => void) | undefined;

  const app = strictProxy<App>({
    vault: {
      getAbstractFileByPath: vi.fn().mockReturnValue(null)
    },
    workspace: {
      getLeavesOfType: castTo<App['workspace']['getLeavesOfType']>(vi.fn(() => leaves)),
      on: castTo<App['workspace']['on']>(vi.fn((name: string, callback: () => void) => {
        if (name === 'layout-change') {
          layoutChangeCallback = callback;
        }
        // A plain stub (not a strictProxy): `registerEvent`'s unload cleanup reads
        // `ref.e?.offref`, and a strictProxy would throw on the unmocked `e` read.
        return castTo<EventRef>({});
      })),
      onLayoutReady: vi.fn((callback: () => void) => {
        layoutReadyCallback = callback;
      })
    }
  });

  const onFileExplorerViewBuilt = vi.fn();
  const component = new FileTreeComponent({ app, onFileExplorerViewBuilt });
  return {
    app,
    component,
    fireLayoutChange: (): void => {
      layoutChangeCallback?.();
    },
    fireLayoutReady: (): void => {
      // The layout-ready component runs its callback on a zero-delay timer.
      layoutReadyCallback?.();
      vi.runAllTimers();
    },
    leaves,
    onFileExplorerViewBuilt
  };
}

describe('FileTreeComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs an instance', () => {
    const { component } = setup();
    expect(component).toBeInstanceOf(FileTreeComponent);
  });

  describe('deleteFromFilesPane', () => {
    it('returns early when no file explorer view exists', () => {
      const { app, component } = setup();
      component.deleteFromFilesPane('some/path');
      expect(vi.mocked(app.workspace.getLeavesOfType)).toHaveBeenCalledWith('file-explorer');
    });

    it('returns early when the file explorer view is still deferred', () => {
      const { app, component } = setup({});
      component.deleteFromFilesPane('some/path');
      expect(vi.mocked(app.vault.getAbstractFileByPath)).not.toHaveBeenCalled();
    });

    it('returns early when the file item does not exist in the view', () => {
      const fileExplorerView = createMockFileExplorerView();
      const { component } = setup(fileExplorerView);
      component.deleteFromFilesPane('some/path');
      expect(fileExplorerView.onDelete).not.toHaveBeenCalled();
    });

    it('returns early when the abstract file is not found', () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'some/path': strictProxy<FileItem>({}) } });
      const { component } = setup(fileExplorerView);
      component.deleteFromFilesPane('some/path');
      expect(fileExplorerView.onDelete).not.toHaveBeenCalled();
    });

    it('calls onDelete when all conditions are met', () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'some/path': strictProxy<FileItem>({}) } });
      const file = strictProxy<TAbstractFile>({ path: 'some/path' });
      const { app, component } = setup(fileExplorerView);
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file);
      component.deleteFromFilesPane('some/path');
      expect(fileExplorerView.onDelete).toHaveBeenCalledWith(file);
    });
  });

  describe('file explorer view tracking', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not report the explorer that already exists at layout ready', () => {
      const { component, fireLayoutChange, fireLayoutReady, onFileExplorerViewBuilt } = setup(createMockFileExplorerView());
      component.load();
      fireLayoutReady();
      fireLayoutChange();
      expect(onFileExplorerViewBuilt).not.toHaveBeenCalled();
    });

    it('reports a deferred explorer once it is built, and only once', () => {
      const deferredView = {};
      const { component, fireLayoutChange, fireLayoutReady, leaves, onFileExplorerViewBuilt } = setup(deferredView);
      component.load();
      fireLayoutReady();
      fireLayoutChange();
      expect(onFileExplorerViewBuilt).not.toHaveBeenCalled();

      leaves[0] = { view: createMockFileExplorerView() };
      fireLayoutChange();
      fireLayoutChange();
      expect(onFileExplorerViewBuilt).toHaveBeenCalledTimes(1);
    });

    it('reports a new explorer view that replaces the known one', () => {
      const { component, fireLayoutChange, fireLayoutReady, leaves, onFileExplorerViewBuilt } = setup(createMockFileExplorerView());
      component.load();
      fireLayoutReady();

      leaves[0] = { view: createMockFileExplorerView() };
      fireLayoutChange();
      expect(onFileExplorerViewBuilt).toHaveBeenCalledTimes(1);
    });

    it('ignores a layout change while there is no explorer at all', () => {
      const { component, fireLayoutChange, fireLayoutReady, onFileExplorerViewBuilt } = setup();
      component.load();
      fireLayoutReady();
      fireLayoutChange();
      expect(onFileExplorerViewBuilt).not.toHaveBeenCalled();
    });
  });

  describe('addToFilesPane', () => {
    it('returns early when no file explorer view exists', () => {
      const { app, component } = setup();
      component.addToFilesPane('some/path');
      expect(vi.mocked(app.workspace.getLeavesOfType)).toHaveBeenCalledWith('file-explorer');
    });

    it('returns early when the item already exists in the view', () => {
      const fileExplorerView = createMockFileExplorerView({ fileItems: { 'some/path': strictProxy<FileItem>({}) } });
      const { component } = setup(fileExplorerView);
      component.addToFilesPane('some/path');
      expect(fileExplorerView.onCreate).not.toHaveBeenCalled();
    });

    it('returns early when the abstract file is not found', () => {
      const fileExplorerView = createMockFileExplorerView();
      const { component } = setup(fileExplorerView);
      component.addToFilesPane('some/path');
      expect(fileExplorerView.onCreate).not.toHaveBeenCalled();
    });

    it('calls onCreate when the file exists and the item is not in the view', () => {
      const fileExplorerView = createMockFileExplorerView();
      const file = strictProxy<TAbstractFile>({ path: 'some/path' });
      const { app, component } = setup(fileExplorerView);
      vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file);
      component.addToFilesPane('some/path');
      expect(fileExplorerView.onCreate).toHaveBeenCalledWith(file);
    });
  });
});
