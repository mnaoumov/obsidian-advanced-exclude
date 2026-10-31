import {
  afterAll,
  describe,
  it
} from 'vitest';

import type { LifecycleStep } from '../../scripts/helpers/performance-lifecycle.ts';

import {
  LIFECYCLE_SCENARIO_TIMEOUT_IN_MS,
  runPerformanceLifecycle
} from '../../scripts/helpers/performance-lifecycle.ts';
import { restorePerformanceVaultExclusions } from '../../scripts/helpers/restore-performance-vault-exclusions.ts';
import { ExcludeMode } from '../settings/plugin-settings.ts';

// This project owns another instance: a real reload must not contaminate the cold-enable fixture.
afterAll(restorePerformanceVaultExclusions);

describe('App start at real-vault scale with the folder hidden: startup stays bounded', () => {
  it.each([ExcludeMode.FilesPane, ExcludeMode.Full])('in %s mode', async (excludeMode) => {
    // Full re-show after a real reload has no snapshots and must restore the folder from disk.
    const steps: LifecycleStep[] = ['switchMode', 'hide', 'restart', excludeMode === ExcludeMode.Full ? 'showCrossSession' : 'showSameSession'];
    await runPerformanceLifecycle(steps, excludeMode);
  }, LIFECYCLE_SCENARIO_TIMEOUT_IN_MS);
});
