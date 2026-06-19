import type { FileExplorerView } from '@obsidian-typings/obsidian-public-latest';
import type {
  App,
  TAbstractFile
} from 'obsidian';

import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
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

interface SetupResult {
  readonly app: App;
  readonly component: FileTreeComponent;
}

function createMockFileExplorerView(overrides: Partial<MockFileExplorerView> = {}): MockFileExplorerView {
  return {
    fileItems: {},
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides
  };
}

function setup(fileExplorerView?: MockFileExplorerView): SetupResult {
  const leaves = fileExplorerView ? [{ view: fileExplorerView }] : [];

  const app = strictProxy<App>({
    vault: {
      getAbstractFileByPath: vi.fn().mockReturnValue(null)
    },
    workspace: {
      getLeavesOfType: vi.fn().mockReturnValue(leaves)
    }
  });

  const component = new FileTreeComponent({ app });
  return { app, component };
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
