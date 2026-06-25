import type { DataAdapterEx } from '@obsidian-typings/obsidian-public-latest';
import type { App as AppOriginal } from 'obsidian';

import { getDataAdapterEx } from '@obsidian-typings/obsidian-public-latest/implementations';
import { strictProxy } from 'obsidian-dev-utils/strict-proxy';
import {
  CapacitorAdapter,
  FileSystemAdapter
} from 'obsidian-test-mocks/obsidian';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import {
  readSafe,
  statSafe,
  writeSafe
} from './data-adapter-safe.ts';

vi.mock('@obsidian-typings/obsidian-public-latest/implementations', () => ({
  getDataAdapterEx: vi.fn()
}));

const mockGetDataAdapterEx = vi.mocked(getDataAdapterEx);

interface MockCapacitorFs {
  read: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
}

interface MockFsPromises {
  access: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
}

describe('data-adapter-safe', () => {
  let mockApp: AppOriginal;

  describe('FileSystemAdapter', () => {
    let adapter: FileSystemAdapter;
    let mockFsPromises: MockFsPromises;

    beforeEach(() => {
      adapter = FileSystemAdapter.create__('/vault');
      mockFsPromises = {
        access: vi.fn(),
        readFile: vi.fn(),
        stat: vi.fn(),
        writeFile: vi.fn()
      };
      Object.assign(adapter, {
        fsPromises: mockFsPromises,
        getFullPath: (path: string): string => `/vault/${path}`
      });
      mockGetDataAdapterEx.mockReturnValue(adapter.asOriginalType__());
      mockApp = strictProxy<AppOriginal>({ vault: { adapter: adapter.asOriginalType__() } });
    });

    describe('readSafe', () => {
      it('should return file content when file exists', async () => {
        mockFsPromises.access.mockResolvedValue(undefined);
        mockFsPromises.readFile.mockResolvedValue('hello world');
        const result = await readSafe(mockApp, 'test.md');
        expect(result).toBe('hello world');
        expect(mockFsPromises.access).toHaveBeenCalledWith('/vault/test.md');
        expect(mockFsPromises.readFile).toHaveBeenCalledWith('/vault/test.md', 'utf8');
      });

      it('should return empty string when file does not exist', async () => {
        mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));
        const result = await readSafe(mockApp, 'missing.md');
        expect(result).toBe('');
      });
    });

    describe('statSafe', () => {
      it('should return null when file does not exist', async () => {
        mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));
        const result = await statSafe(mockApp, 'missing.md');
        expect(result).toBeNull();
      });

      it('should return stat for a file', async () => {
        mockFsPromises.access.mockResolvedValue(undefined);
        mockFsPromises.stat.mockResolvedValue({
          birthtimeMs: 1000.4,
          isFile: (): boolean => true,
          mtimeMs: 2000.7,
          size: 42
        });
        const result = await statSafe(mockApp, 'test.md');
        expect(result).toEqual({
          ctime: 1000,
          mtime: 2001,
          size: 42,
          type: 'file'
        });
      });

      it('should return stat for a directory', async () => {
        mockFsPromises.access.mockResolvedValue(undefined);
        mockFsPromises.stat.mockResolvedValue({
          birthtimeMs: 3000,
          isFile: (): boolean => false,
          mtimeMs: 4000,
          size: 0
        });
        const result = await statSafe(mockApp, 'folder');
        expect(result).toEqual({
          ctime: 3000,
          mtime: 4000,
          size: 0,
          type: 'directory'
        });
      });
    });

    describe('writeSafe', () => {
      it('should write content to file', async () => {
        mockFsPromises.writeFile.mockResolvedValue(undefined);
        await writeSafe(mockApp, 'test.md', 'content');
        expect(mockFsPromises.writeFile).toHaveBeenCalledWith('/vault/test.md', 'content');
      });
    });
  });

  describe('CapacitorAdapter', () => {
    let adapter: CapacitorAdapter;
    let mockFs: MockCapacitorFs;

    beforeEach(() => {
      adapter = CapacitorAdapter.create__('/vault', {});
      mockFs = {
        read: vi.fn(),
        stat: vi.fn(),
        write: vi.fn()
      };
      Object.assign(adapter, {
        fs: mockFs,
        getFullPath: (path: string): string => `/vault/${path}`
      });
      mockGetDataAdapterEx.mockReturnValue(adapter.asOriginalType__());
      mockApp = strictProxy<AppOriginal>({ vault: { adapter: adapter.asOriginalType__() } });
    });

    describe('readSafe', () => {
      it('should return file content when file exists', async () => {
        mockFs.stat.mockResolvedValue({});
        mockFs.read.mockResolvedValue('cap content');
        const result = await readSafe(mockApp, 'test.md');
        expect(result).toBe('cap content');
      });

      it('should return empty string when file does not exist', async () => {
        mockFs.stat.mockRejectedValue(new Error('not found'));
        const result = await readSafe(mockApp, 'missing.md');
        expect(result).toBe('');
      });
    });

    describe('statSafe', () => {
      it('should return null when file does not exist', async () => {
        mockFs.stat.mockRejectedValue(new Error('not found'));
        const result = await statSafe(mockApp, 'missing.md');
        expect(result).toBeNull();
      });

      it('should return stat with fallback values', async () => {
        mockFs.stat
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            ctime: undefined,
            mtime: undefined,
            size: undefined,
            type: 'file'
          });
        const result = await statSafe(mockApp, 'test.md');
        expect(result).toEqual({
          ctime: 0,
          mtime: 0,
          size: 0,
          type: 'file'
        });
      });

      it('should return stat with provided values', async () => {
        mockFs.stat
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({
            ctime: 100,
            mtime: 200,
            size: 50,
            type: 'directory'
          });
        const result = await statSafe(mockApp, 'folder');
        expect(result).toEqual({
          ctime: 100,
          mtime: 200,
          size: 50,
          type: 'directory'
        });
      });
    });

    describe('writeSafe', () => {
      it('should write content via capacitor fs', async () => {
        mockFs.write.mockResolvedValue(undefined);
        await writeSafe(mockApp, 'test.md', 'content');
        expect(mockFs.write).toHaveBeenCalledWith('/vault/test.md', 'content');
      });
    });
  });

  describe('Unknown adapter', () => {
    beforeEach(() => {
      const unknownAdapter = strictProxy<DataAdapterEx>({
        getFullPath: (path: string): string => `/vault/${path}`
      });
      mockGetDataAdapterEx.mockReturnValue(unknownAdapter);
      mockApp = strictProxy<AppOriginal>({ vault: { adapter: unknownAdapter } });
    });

    it('readSafe should throw for unknown adapter after existsSafe throws', async () => {
      await expect(readSafe(mockApp, 'test.md')).rejects.toThrow('Unknown adapter');
    });

    it('readSafe should throw for unknown adapter when file exists via known adapter', async () => {
      const fsAdapter = FileSystemAdapter.create__('/vault');
      Object.assign(fsAdapter, {
        fsPromises: { access: vi.fn().mockResolvedValue(undefined) },
        getFullPath: (path: string): string => `/vault/${path}`
      });
      const unknownAdapter = strictProxy<DataAdapterEx>({ getFullPath: (path: string): string => `/vault/${path}` });
      // First call (in existsSafe) returns FileSystemAdapter, second call (in readSafe) returns unknown
      mockGetDataAdapterEx
        .mockReturnValueOnce(fsAdapter.asOriginalType__())
        .mockReturnValueOnce(unknownAdapter);
      await expect(readSafe(mockApp, 'test.md')).rejects.toThrow('Unknown adapter');
    });

    it('statSafe should throw for unknown adapter after existsSafe throws', async () => {
      await expect(statSafe(mockApp, 'test.md')).rejects.toThrow('Unknown adapter');
    });

    it('statSafe should throw for unknown adapter when file exists via known adapter', async () => {
      const fsAdapter = FileSystemAdapter.create__('/vault');
      Object.assign(fsAdapter, {
        fsPromises: { access: vi.fn().mockResolvedValue(undefined) },
        getFullPath: (path: string): string => `/vault/${path}`
      });
      const unknownAdapter = strictProxy<DataAdapterEx>({ getFullPath: (path: string): string => `/vault/${path}` });
      // First call (in existsSafe) returns FileSystemAdapter, second call (in statSafe) returns unknown
      mockGetDataAdapterEx
        .mockReturnValueOnce(fsAdapter.asOriginalType__())
        .mockReturnValueOnce(unknownAdapter);
      await expect(statSafe(mockApp, 'test.md')).rejects.toThrow('Unknown adapter');
    });

    it('writeSafe should throw for unknown adapter', async () => {
      await expect(writeSafe(mockApp, 'test.md', 'content')).rejects.toThrow('Unknown adapter');
    });
  });
});
