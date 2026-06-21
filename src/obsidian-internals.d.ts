export {};

declare module 'obsidian' {
  interface MetadataCache {
    /**
     * Re-queues every file whose resolved or unresolved links reference any of
     * `names` for link resolution. Internal Obsidian API; the public typings
     * declare only a single-`string` form, but the real method takes an array
     * (`app.js` does `names.map(...)`) and is called once per deleted file during
     * a bulk removal — the source of the O(N²) folder-hide cost this plugin
     * batches around. This overload adds the real array signature.
     */
    updateRelatedLinks(names: string[]): void;
  }
}
