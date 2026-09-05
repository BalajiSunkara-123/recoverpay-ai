/**
 * Unit Tests for RecoverPay Dataset Integrity & Invariant Validation
 * Uses Node.js native test runner via tsx.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSyntheticDataset, toAgentInputContext } from '../server/data/generator.ts';
import { FailureCategory, RecoveryAction, PolicyRules } from '../src/types/index.ts';

describe('RecoverPay Synthetic Dataset Invariants', () => {
  const { payments, customers, stats } = generateSyntheticDataset(1337);

  test('Total records must equal exactly 600', () => {
    assert.equal(payments.length, 600, `Expected 600 payments, received ${payments.length}`);
    assert.equal(customers.length, 600, `Expected 600 customers, received ${customers.length}`);
    assert.equal(stats.total_records, 600, `Expected stats.total_records to be 600`);
  });

  test('Category distribution matches exact targets', () => {
    const expectedDist: Record<FailureCategory, number> = {
      TRANSIENT_BANK_FAILURE: 192,
      NETWORK_ERROR: 108,
      INSUFFICIENT_FUNDS: 144,
      AUTHENTICATION_FAILURE: 84,
      EXPIRED_CARD: 48,
      FATAL_DECLINE: 24
    };

    const actualDist: Record<FailureCategory, number> = {
      TRANSIENT_BANK_FAILURE: 0,
      NETWORK_ERROR: 0,
      INSUFFICIENT_FUNDS: 0,
      AUTHENTICATION_FAILURE: 0,
      EXPIRED_CARD: 0,
      FATAL_DECLINE: 0
    };

    for (const p of payments) {
      actualDist[p.failure_category]++;
    }

    assert.deepEqual(actualDist, expectedDist, 'Category distribution deviates from specified target');
    assert.deepEqual(stats.category_distribution, expectedDist, 'Stats object distribution mismatch');
  });

  test('Edge case 1: Opted-out records must equal exactly 25', () => {
    const customerMap = new Map(customers.map(c => [c.id, c]));
    const optedOutCount = payments.filter(p => customerMap.get(p.customer_id)?.opted_out === true).length;
    assert.equal(optedOutCount, 25, `Expected 25 opted-out records, got ${optedOutCount}`);
    assert.equal(stats.edge_cases.opted_out_count, 25);
  });

  test('Edge case 2: High-value records (> ₹50,000 / 5,000,000 paise) must equal exactly 35', () => {
    const highValueCount = payments.filter(p => p.amount > 5000000).length;
    assert.equal(highValueCount, 35, `Expected 35 high-value records, got ${highValueCount}`);
    assert.equal(stats.edge_cases.high_value_count, 35);
  });

  test('Edge case 3: Max-retries records (recovery_attempts = 2) must equal exactly 30', () => {
    const maxRetryCount = payments.filter(p => p.recovery_attempts === 2).length;
    assert.equal(maxRetryCount, 30, `Expected 30 max-retries records, got ${maxRetryCount}`);
    assert.equal(stats.edge_cases.max_retries_count, 30);
  });

  test('Edge case 4: Cooldown-active records (seconds_since_failure < 900) must equal exactly 20', () => {
    const cooldownCount = payments.filter(p => p.seconds_since_failure < 900).length;
    assert.equal(cooldownCount, 20, `Expected 20 cooldown-active records, got ${cooldownCount}`);
    assert.equal(stats.edge_cases.cooldown_active_count, 20);
  });

  test('Uniqueness: No duplicate payment IDs or customer IDs', () => {
    const paymentIds = new Set<string>();
    for (const p of payments) {
      assert.ok(!paymentIds.has(p.id), `Duplicate payment ID detected: ${p.id}`);
      paymentIds.add(p.id);
    }
    assert.equal(paymentIds.size, 600);

    const customerIds = new Set<string>();
    for (const c of customers) {
      assert.ok(!customerIds.has(c.id), `Duplicate customer ID detected: ${c.id}`);
      customerIds.add(c.id);
    }
    assert.equal(customerIds.size, 600);
  });

  test('Integrity: Every payment references a valid customer and amount > 0', () => {
    const customerMap = new Map(customers.map(c => [c.id, c]));
    for (const p of payments) {
      assert.ok(customerMap.has(p.customer_id), `Payment ${p.id} has invalid customer_id ${p.customer_id}`);
      assert.ok(p.amount > 0, `Payment ${p.id} has non-positive amount: ${p.amount}`);
      assert.ok(Number.isInteger(p.amount), `Payment ${p.id} amount is not integer paise: ${p.amount}`);
    }
  });

  test('ISO Timestamps: Every record has parseable ISO 8601 timestamps', () => {
    for (const p of payments) {
      const createdDate = new Date(p.created_at);
      const updatedDate = new Date(p.updated_at);
      const lastAttemptDate = new Date(p.last_attempt_at);

      assert.ok(!isNaN(createdDate.getTime()), `Invalid created_at: ${p.created_at}`);
      assert.ok(!isNaN(updatedDate.getTime()), `Invalid updated_at: ${p.updated_at}`);
      assert.ok(!isNaN(lastAttemptDate.getTime()), `Invalid last_attempt_at: ${p.last_attempt_at}`);
    }
  });

  test('Ground Truth: Every ground_truth_best_action is valid enum and boolean matches', () => {
    const validActions: RecoveryAction[] = ['RETRY_PAYMENT', 'SEND_PAYMENT_REMINDER', 'ESCALATE', 'STOP'];

    for (const p of payments) {
      assert.ok(
        validActions.includes(p.ground_truth_best_action),
        `Invalid ground_truth_best_action on ${p.id}: ${p.ground_truth_best_action}`
      );
      assert.equal(typeof p.ground_truth_recoverable, 'boolean');
      assert.ok(
        p.ground_truth_expected_outcome === 'RECOVERED' || p.ground_truth_expected_outcome === 'PERMANENTLY_FAILED',
        `Invalid ground_truth_expected_outcome on ${p.id}`
      );
      assert.ok(p.ground_truth_reason.length > 5, `Missing ground_truth_reason on ${p.id}`);
    }
  });

  test('Data Isolation: toAgentInputContext MUST NOT leak ground truth fields', () => {
    const samplePayment = payments[0];
    const sampleCustomer = customers[0];
    const samplePolicy: PolicyRules = {
      id: 'pol_test',
      max_retries: 2,
      max_automated_recovery_amount: 5000000,
      min_retry_cooldown_seconds: 900,
      do_not_retry_after_success: true,
      do_not_retry_if_customer_opted_out: true,
      low_confidence_threshold: 0.60
    };

    const agentContext = toAgentInputContext(samplePayment, sampleCustomer, samplePolicy);

    // Deep inspect keys in context
    const contextJson = JSON.stringify(agentContext);

    assert.ok(!contextJson.includes('ground_truth'), 'CRITICAL LEAKAGE: "ground_truth" detected in AgentInputContext!');
    assert.ok(!contextJson.includes('best_action'), 'CRITICAL LEAKAGE: "best_action" detected in AgentInputContext!');
    assert.ok(!contextJson.includes('expected_outcome'), 'CRITICAL LEAKAGE: "expected_outcome" detected in AgentInputContext!');

    const paymentKeys = Object.keys(agentContext.payment);
    const forbiddenKeys = [
      'ground_truth_recoverable',
      'ground_truth_best_action',
      'ground_truth_expected_outcome',
      'ground_truth_reason'
    ];

    for (const fk of forbiddenKeys) {
      assert.ok(!paymentKeys.includes(fk), `Payment sub-object leaked forbidden key: ${fk}`);
    }
  });
});
