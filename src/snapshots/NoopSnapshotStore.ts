import type { ISnapshotStore } from '../core';

/**
 * No-op snapshot store. Used by deployments that don't care about raw-record
 * archival (proxy tier, memory tier, dev loops, CI).
 */
export class NoopSnapshotStore implements ISnapshotStore {
  async put(_key: string, _value: string): Promise<void> {
    // Intentionally empty.
  }
}
