/**
 * RecoverPay Idempotency Manager
 * Prevents duplicate recovery executions from network retries, double-clicks,
 * replayed webhooks, or repeated agent evaluations.
 */

import { ToolResult } from '../../src/types/index.ts';

interface IdempotencyRecord {
  key: string;
  paymentId: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  result?: ToolResult;
  createdAt: string;
  completedAt?: string;
}

class IdempotencyStore {
  private cache = new Map<string, IdempotencyRecord>();

  /**
   * Generates a deterministic idempotency key for an action attempt on a payment
   */
  public generateKey(paymentId: string, recoveryAttempts: number, action: string): string {
    return `idem_${paymentId}_attempt${recoveryAttempts}_${action}`;
  }

  /**
   * Checks if an idempotency key is already in progress or completed.
   */
  public check(key: string): { exists: boolean; inProgress: boolean; result?: ToolResult } {
    const record = this.cache.get(key);
    if (!record) {
      return { exists: false, inProgress: false };
    }
    if (record.status === 'IN_PROGRESS') {
      return { exists: true, inProgress: true };
    }
    return { exists: true, inProgress: false, result: record.result };
  }

  /**
   * Locks the key as IN_PROGRESS to prevent concurrent duplicate execution.
   */
  public lock(key: string, paymentId: string): boolean {
    const existing = this.cache.get(key);
    if (existing) {
      return false; // Already locked or completed
    }
    this.cache.set(key, {
      key,
      paymentId,
      status: 'IN_PROGRESS',
      createdAt: new Date().toISOString()
    });
    return true;
  }

  /**
   * Commits the completed ToolResult against the idempotency key.
   */
  public commit(key: string, result: ToolResult): void {
    const record = this.cache.get(key);
    if (record) {
      record.status = 'COMPLETED';
      record.result = result;
      record.completedAt = new Date().toISOString();
    } else {
      this.cache.set(key, {
        key,
        paymentId: result.payment_id,
        status: 'COMPLETED',
        result,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      });
    }
  }

  /**
   * Releases lock in case of unexpected unhandled failure
   */
  public release(key: string): void {
    const record = this.cache.get(key);
    if (record && record.status === 'IN_PROGRESS') {
      this.cache.delete(key);
    }
  }

  /**
   * Clears the cache (for testing)
   */
  public clear(): void {
    this.cache.clear();
  }
}

export const idempotencyStore = new IdempotencyStore();
