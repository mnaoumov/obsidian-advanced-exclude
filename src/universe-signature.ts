/**
 * A compact, order-independent signature of the vault's loaded-file *universe* —
 * every path the plugin could show, hidden or visible.
 *
 * The fast-enable path applies the persisted hidden set directly, trusting that
 * the vault has not changed on disk while the plugin was disabled. The ignore
 * config fingerprint (the `.obsidianignore`/`.gitignore` mtime) does **not** catch a
 * file created or deleted while disabled, so a separate universe signature guards
 * it: recomputed on enable and compared against the value persisted with the
 * hidden set. A mismatch falls back to the proven full recompute.
 *
 * It must be **order-independent** (Obsidian does not guarantee a stable path
 * iteration order) and computed over a **deduplicated** set: on a warm re-enable
 * `getAllLoadedFiles()` already includes the just-restored hidden files, so the
 * caller passes `hidden ∪ loaded` and this function collapses the overlap — the
 * same set (and signature) it produced at persist time, when the hidden files
 * were absent from the loaded tree.
 */
export function computeUniverseSignature(paths: Iterable<string>): string {
  let sum = 0;
  let count = 0;
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    // Order-independent: an unsigned 32-bit sum of per-path hashes. Paired with
    // The distinct-path count so two different sets sharing a hash sum still differ.
    sum = (sum + fnv1a32(path)) >>> 0;
    count++;
  }
  return `${count.toString(36)}:${sum.toString(36)}`;
}

/**
 * 32-bit FNV-1a hash of `text`. A fast, well-distributed non-cryptographic hash;
 * the signature only needs to change when the path set changes, not to resist an
 * adversary.
 */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
