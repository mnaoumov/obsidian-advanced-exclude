import type { GenericFunction } from '@mnaoumov/typescript-lib/function';
import type { App } from 'obsidian';

/**
 * A feature of Obsidian's that asks `metadataCache.isUserIgnored`, as far as the `Soft` exclude mode can tell them apart.
 */
export enum SoftExcludeFeature {
  Graph = 'Graph',
  Other = 'Other',
  Search = 'Search',
  UnlinkedMentions = 'UnlinkedMentions'
}

/**
 * An object whose `app` a core view reads when one of its methods starts.
 */
export interface AppHolder {
  // eslint-disable-next-line typescript-dev-toolkit/readonly-interface-members -- callWithScopedApp swaps it for one call.
  app: App;
}

/**
 * Runs {@link callback} while {@link holder}'s own `app` property reads {@link scopedApp}, and restores it afterwards.
 *
 * A core view's entry method reads `this.app` before its first `await` and keeps that reference for the rest of its run,
 * its async loop included, so swapping the property for the synchronous part of the call scopes the whole run. An `app`
 * that is not an own writable data property is left alone.
 *
 * @returns What {@link callback} returns.
 */
export function callWithScopedApp<T>(holder: AppHolder, scopedApp: App, callback: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(holder, 'app');
  if (!descriptor?.writable) {
    return callback();
  }
  const originalApp = holder.app;
  holder.app = scopedApp;
  try {
    return callback();
  } finally {
    holder.app = originalApp;
  }
}

/**
 * Creates a view of {@link app} whose `metadataCache.isUserIgnored` is {@link isUserIgnored}. Every other member reads
 * through to the real object, its methods bound to it, so nothing is copied and nothing goes stale.
 *
 * @returns The scoped app.
 */
export function createFeatureScopedApp(app: App, isUserIgnored: (path: string) => boolean): App {
  const metadataCache = createOverridingProxy(app.metadataCache, 'isUserIgnored', isUserIgnored);
  return createOverridingProxy(app, 'metadataCache', metadataCache);
}

function createOverridingProxy<T extends object, Key extends keyof T>(target: T, key: Key, value: T[Key]): T {
  return new Proxy(target, {
    get(proxyTarget, property): unknown {
      if (property === key) {
        return value;
      }
      const propertyValue: unknown = Reflect.get(proxyTarget, property);
      return typeof propertyValue === 'function' ? (propertyValue as GenericFunction).bind(proxyTarget) : propertyValue;
    }
  });
}
