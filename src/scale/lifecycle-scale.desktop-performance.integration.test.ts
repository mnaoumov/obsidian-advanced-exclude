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

afterAll(restorePerformanceVaultExclusions);

describe('Lifecycle at real-vault scale: every step stays bounded', () => {
  it.each([ExcludeMode.Full, ExcludeMode.FilesPane])('in %s mode', async (excludeMode) => {
    const steps: LifecycleStep[] = excludeMode === ExcludeMode.Full
      ? ['switchMode', 'coldEnable', 'warmReEnable', 'hide', 'showSameSession', 'hide', 'showCrossSession']
      : ['switchMode', 'hide', 'showSameSession'];
    await runPerformanceLifecycle(steps, excludeMode);
  }, LIFECYCLE_SCENARIO_TIMEOUT_IN_MS);
});
