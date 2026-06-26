export {};

/**
 * The internal renderer behind the Backlinks / Outgoing Links side-panes. It caches the
 * file it last computed in its `*File` fields; clearing those and calling `update()` forces
 * a recompute from the current link cache without firing any event.
 */
interface LinkViewRenderer {
  backlinkFile?: unknown;
  outgoingFile?: unknown;
  unlinkedFile?: unknown;
  update?(this: void): void;
}

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

  interface View {
    /**
     * The Backlinks side-pane's renderer (present on the `backlink` view). Internal,
     * undocumented; accessed only to force an event-free recompute after a projection.
     */
    backlink?: LinkViewRenderer | undefined;

    /**
     * The Outgoing Links side-pane's renderer (present on the `outgoing-link` view).
     * Internal, undocumented; accessed only to force an event-free recompute after a
     * projection.
     */
    outgoingLink?: LinkViewRenderer | undefined;
  }
}
