import { ensureNonNullable } from 'obsidian-dev-utils/type-guards';

import { ROOT_PATH } from './constants.ts';

/**
 * Predicate matching the matcher in `IgnorePatternsComponent.isIgnored`.
 */
export type IsIgnoredFn = (normalizedPath: string, isFolder: boolean) => boolean;

/**
 * An entry used to seed the model: a vault-relative normalized path and whether
 * it is a folder.
 */
export interface VaultModelEntry {
  readonly isFolder: boolean;
  readonly path: string;
}

/**
 * A visibility flip produced by an incremental recompute. `isVisible` is the new
 * value after the change.
 */
export interface VisibilityChange {
  readonly isFolder: boolean;
  readonly isVisible: boolean;
  readonly path: string;
}

interface VaultModelNode {
  children: Map<string, VaultModelNode> | null;
  isFolder: boolean;
  isIgnoredSelf: boolean;
  isVisible: boolean;
  parent: null | VaultModelNode;
  path: string;
}

/**
 * In-memory unfiltered shadow tree of the vault plus a derived visibility state.
 *
 * Visibility is computed bottom-up so that `.gitignore` negation is honored:
 * - a file is visible iff it is not ignored;
 * - a folder is visible iff it is not ignored OR it has any visible descendant.
 *
 * The second clause is why a folder whose own path tests ignored can still be
 * visible — it must remain in the tree to keep a re-included descendant
 * reachable.
 */
export class VaultModel {
  public get size(): number {
    return this.nodes.size;
  }

  private readonly isIgnored: IsIgnoredFn;
  private readonly nodes = new Map<string, VaultModelNode>();
  private readonly root: VaultModelNode;

  public constructor(isIgnored: IsIgnoredFn) {
    this.isIgnored = isIgnored;
    this.root = {
      children: new Map(),
      isFolder: true,
      isIgnoredSelf: false,
      isVisible: true,
      parent: null,
      path: ROOT_PATH
    };
    this.nodes.set(ROOT_PATH, this.root);
  }

  /**
   * Removes a path and its entire subtree from the model, then recomputes the
   * ancestor chain (a folder may flip hidden once it loses its last visible
   * child). Returns the visibility flips among the surviving ancestors.
   */
  public deletePath(normalizedPath: string): VisibilityChange[] {
    const node = this.nodes.get(normalizedPath);
    if (!node || node === this.root) {
      return [];
    }

    this.removeSubtree(node);
    node.parent?.children?.delete(normalizedPath);

    return this.propagateFrom(node.parent);
  }

  /**
   * Returns the minimal set of hidden nodes to remove from Obsidian's index: a
   * hidden node whose parent is still visible. Removing such a node cascades to
   * its descendants, so descendants of a hidden node are omitted.
   */
  public getHideRoots(): VaultModelEntry[] {
    const result: VaultModelEntry[] = [];
    for (const node of this.nodes.values()) {
      if (node === this.root || node.isVisible) {
        continue;
      }
      if (node.parent?.isVisible) {
        result.push({ isFolder: node.isFolder, path: node.path });
      }
    }
    return result;
  }

  /**
   * Returns every known path whose current visibility matches `isVisible`.
   */
  public getPathsByVisibility(isVisible: boolean): VaultModelEntry[] {
    const result: VaultModelEntry[] = [];
    for (const node of this.nodes.values()) {
      if (node === this.root) {
        continue;
      }
      if (node.isVisible === isVisible) {
        result.push({ isFolder: node.isFolder, path: node.path });
      }
    }
    return result;
  }

  public isKnown(normalizedPath: string): boolean {
    return this.nodes.has(normalizedPath);
  }

  /**
   * Returns the current visibility of a path, or `undefined` if unknown.
   */
  public isVisible(normalizedPath: string): boolean | undefined {
    return this.nodes.get(normalizedPath)?.isVisible;
  }

  /**
   * Clears the model and rebuilds it from `entries`, then computes visibility
   * for the whole tree.
   */
  public rebuild(entries: readonly VaultModelEntry[]): void {
    this.nodes.clear();
    this.root.children = new Map();
    this.root.isVisible = true;
    this.nodes.set(ROOT_PATH, this.root);

    for (const entry of entries) {
      this.ensureNode(entry.path, entry.isFolder);
    }

    this.recomputeAll();
  }

  /**
   * Re-evaluates the ignore verdict and visibility for every node (used after a
   * config / pattern change). Processes deepest nodes first so a folder sees its
   * children's final visibility. Returns the visibility flips.
   */
  public recomputeAll(): VisibilityChange[] {
    const sorted = [...this.nodes.values()].sort((a, b) => depth(b.path) - depth(a.path));
    for (const node of sorted) {
      this.evaluateIgnored(node);
    }
    const changes: VisibilityChange[] = [];
    for (const node of sorted) {
      const wasVisible = node.isVisible;
      node.isVisible = this.computeVisible(node);
      if (node.isVisible !== wasVisible && node !== this.root) {
        changes.push({ isFolder: node.isFolder, isVisible: node.isVisible, path: node.path });
      }
    }
    return changes;
  }

  /**
   * Re-evaluates a single path's ignore verdict and visibility, propagating any
   * flip up the ancestor chain until it stabilizes. Returns the flips.
   */
  public recomputeFrom(normalizedPath: string): VisibilityChange[] {
    const node = this.nodes.get(normalizedPath);
    if (!node) {
      return [];
    }
    this.evaluateIgnored(node);
    return this.propagateFrom(node);
  }

  /**
   * Inserts or updates a path (creating any missing ancestor folders), evaluates
   * its ignore verdict, and propagates visibility up the ancestor chain. Returns
   * the visibility flips.
   */
  public setPath(normalizedPath: string, isFolder: boolean): VisibilityChange[] {
    const node = this.ensureNode(normalizedPath, isFolder);
    this.evaluateIgnored(node);
    return this.propagateFrom(node);
  }

  private computeVisible(node: VaultModelNode): boolean {
    if (node === this.root) {
      return true;
    }
    if (!node.isFolder) {
      return !node.isIgnoredSelf;
    }
    if (!node.isIgnoredSelf) {
      return true;
    }
    const children = ensureNonNullable(node.children);
    for (const child of children.values()) {
      if (child.isVisible) {
        return true;
      }
    }
    return false;
  }

  private ensureNode(normalizedPath: string, isFolder: boolean): VaultModelNode {
    const existing = this.nodes.get(normalizedPath);
    if (existing) {
      return existing;
    }

    const parentPath = getParentPath(normalizedPath);
    const parent = this.ensureNode(parentPath, true);

    const node: VaultModelNode = {
      children: isFolder ? new Map() : null,
      isFolder,
      isIgnoredSelf: false,
      isVisible: false,
      parent,
      path: normalizedPath
    };
    this.nodes.set(normalizedPath, node);
    parent.children?.set(normalizedPath, node);
    return node;
  }

  private evaluateIgnored(node: VaultModelNode): void {
    node.isIgnoredSelf = node === this.root ? false : this.isIgnored(node.path, node.isFolder);
  }

  private propagateFrom(start: null | VaultModelNode): VisibilityChange[] {
    const changes: VisibilityChange[] = [];
    let current = start;
    while (current) {
      const newVisible = this.computeVisible(current);
      if (newVisible === current.isVisible) {
        break;
      }
      current.isVisible = newVisible;
      changes.push({ isFolder: current.isFolder, isVisible: newVisible, path: current.path });
      current = current.parent;
    }
    return changes;
  }

  private removeSubtree(node: VaultModelNode): void {
    for (const child of node.children?.values() ?? []) {
      this.removeSubtree(child);
    }
    this.nodes.delete(node.path);
  }
}

function depth(normalizedPath: string): number {
  if (normalizedPath === ROOT_PATH) {
    return 0;
  }
  let count = 1;
  for (const char of normalizedPath) {
    if (char === '/') {
      count++;
    }
  }
  return count;
}

function getParentPath(normalizedPath: string): string {
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex === -1 ? ROOT_PATH : normalizedPath.slice(0, lastSlashIndex);
}
