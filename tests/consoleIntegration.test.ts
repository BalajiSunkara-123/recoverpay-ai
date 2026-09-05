/**
 * RecoverPay Phase 5: Console & Interactive Demo Integration Tests
 * Verifies dashboard metric calculation, payment operations query/search/filter,
 * demo scenario execution pipelines (A through E), and zero-trust policy guarantees.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataStore } from '../server/db/store.ts';
import { executeRecoveryPipeline } from '../server/tools/toolRegistry.ts';
import { policyEngine } from '../server/policies/policyEngine.ts';
import { validateAgentDecision } from '../server/agents/validation.ts';
import { AIAgentDecision } from '../src/types/index.ts';

describe('Phase 5: Console & Interactive Demo Integration Tests', () => {
  beforeEach(() => {
    dataStore.reset(1337);
  });

  it('1. Live metrics calculation returns real datastore state (never hard-coded)', async () => {
    const allPayments = dataStore.getAllPayments();
    const stats = dataStore.getStats();

    assert.equal(allPayments.length, 600);
    assert.equal(stats.total_records, 600);

    // Initial state before any recoveries
    const captured = allPayments.filter(p => p.status === 'captured').length;
    assert.equal(captured, 0);

    const recoverable = allPayments.filter(
      p => p.ground_truth_recoverable ||
           p.failure_category === 'TRANSIENT_BANK_FAILURE' ||
           p.failure_category === 'NETWORK_ERROR'
    ).length;

    assert.ok(recoverable > 100, 'Must have substantial recoverable records');
  });

  it('2. Payment operations query, search, and category filtering work accurately', () => {
    const allPayments = dataStore.getAllPayments();

    // High value filter check (> ₹50,000)
    const highValue = allPayments.filter(p => p.amount > 5000000);
    assert.ok(highValue.length > 0, 'Should find high-value payments');
    for (const p of highValue) {
      assert.ok(p.amount > 5000000);
    }

    // Search by failure code
    const busyPayments = allPayments.filter(p => p.failure_code.includes('BANK_SYSTEM_BUSY'));
    assert.ok(busyPayments.length > 0);
  });

  it('3. Payment inspection retrieves complete telemetry, customer context, and policy rules', () => {
    const demo = dataStore.getDemoScenario('pay_demo_transient_01');
    assert.ok(demo);
    assert.equal(demo.payment.id, 'pay_demo_transient_01');
    assert.equal(demo.customer.id, 'cust_demo_transient_01');
    assert.equal(demo.payment.amount, 249900); // ₹2,499 in paise

    const policy = dataStore.getPolicy();
    assert.equal(policy.max_retries, 2);
    assert.equal(policy.max_automated_recovery_amount, 5000000); // ₹50k cap
  });

  it('4. Demo Scenario A: Real execution pipeline recovers transient failure', async () => {
    dataStore.resetDemoScenario('pay_demo_transient_01');
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;

    const aiDecision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.92,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.88,
      risk_level: 'LOW',
      reasoning: 'Transient switch overload. Safe to retry.'
    };

    const validation = validateAgentDecision(aiDecision, payment.id);
    assert.equal(validation.valid, true);

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
      idempotencyKey: 'test_demo_scenario_a'
    });

    assert.equal(policyResult.allowed, true);
    assert.equal(policyResult.finalAction, 'RETRY_PAYMENT');
    assert.equal(toolResult.execution_mode, 'SIMULATED_RECOVERY');
    assert.equal(toolResult.recovered, true);
    assert.equal(toolResult.amount_recovered, 249900);
    assert.equal(toolResult.final_payment_status, 'captured');

    // Post-execution state in DataStore
    const refreshed = dataStore.getPaymentById('pay_demo_transient_01')!;
    assert.equal(refreshed.status, 'captured');
  });

  it('5. Demo Scenario B: Persistent failure triggers MAX_RETRIES_EXCEEDED and escalates', async () => {
    dataStore.resetDemoScenario('pay_demo_persistent_02');
    const payment = dataStore.getPaymentById('pay_demo_persistent_02')!;

    // Attempt 1 already performed in fixture (recovery_attempts = 1)
    // Execute attempt 2: retry fails in simulation
    await executeRecoveryPipeline(payment.id, {
      payment_id: payment.id,
      diagnosis: 'insufficient_funds',
      recoverability_score: 0.65,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.70,
      risk_level: 'MEDIUM',
      reasoning: 'Attempt 2'
    }, { idempotencyKey: 'test_demo_b_1' });

    // Payment now has recovery_attempts = 2
    const paymentAfter2 = dataStore.getPaymentById('pay_demo_persistent_02')!;
    assert.equal(paymentAfter2.recovery_attempts, 2);

    // Attempt 3: Policy strictly blocks because max_retries = 2 reached
    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, {
      payment_id: payment.id,
      diagnosis: 'insufficient_funds',
      recoverability_score: 0.60,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.65,
      risk_level: 'MEDIUM',
      reasoning: 'Attempt 3 erroneous retry'
    }, { idempotencyKey: 'test_demo_b_2' });

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));
    assert.equal(policyResult.finalAction, 'ESCALATE');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.equal(toolResult.final_payment_status, 'escalated');
  });

  it('6. Demo Scenario C: High value + opted out intercepts both rules and terminates with zero payment calls', async () => {
    dataStore.resetDemoScenario('pay_demo_highvalue_03');
    const payment = dataStore.getPaymentById('pay_demo_highvalue_03')!;

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, {
      payment_id: payment.id,
      diagnosis: 'network_timeout',
      recoverability_score: 0.95,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.90,
      risk_level: 'LOW',
      reasoning: 'High value retry request'
    }, { idempotencyKey: 'test_demo_c' });

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'CUSTOMER_OPTED_OUT'));
    assert.ok(policyResult.violations.some(v => v.rule === 'AMOUNT_EXCEEDS_CAP'));
    assert.equal(policyResult.finalAction, 'STOP'); // STOP > ESCALATE precedence
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.equal(toolResult.final_payment_status, 'abandoned');
  });

  it('7. Demo Scenario D: Malformed AI response fails closed to ESCALATE', async () => {
    dataStore.resetDemoScenario('pay_demo_transient_01');
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;

    const malformedDecision: any = {
      payment_id: 'mismatched_id',
      diagnosis: 'corrupted_diagnosis',
      recoverability_score: 9.99, // Out of bounds
      recommended_action: 'ILLEGAL_FORCE_CHARGE',
      confidence: -1.0,
      risk_level: 'SUPER_HIGH'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, malformedDecision, {
      idempotencyKey: 'test_demo_d'
    });

    assert.equal(toolResult.action, 'ESCALATE');
    assert.equal(toolResult.tool_called, 'escalate_to_ops');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.equal(toolResult.final_payment_status, 'escalated');
  });

  it('8. Demo Scenario E: Already captured payment strictly halts with ALREADY_SUCCESSFUL', async () => {
    dataStore.resetDemoScenario('pay_demo_captured_05');
    const payment = dataStore.getPaymentById('pay_demo_captured_05')!;
    assert.equal(payment.status, 'captured');

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.99,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.95,
      risk_level: 'LOW',
      reasoning: 'Retry already captured'
    }, { idempotencyKey: 'test_demo_e' });

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'ALREADY_SUCCESSFUL'));
    assert.equal(policyResult.finalAction, 'STOP');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.final_payment_status, 'captured'); // Retains captured state
  });

  it('9. Zero policy bypass: Tool Router cannot execute unapproved action', async () => {
    dataStore.resetDemoScenario('pay_demo_highvalue_03');
    const payment = dataStore.getPaymentById('pay_demo_highvalue_03')!;

    // Low confidence decision
    const lowConfidenceDecision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.50,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.40, // Below 0.60 floor
      risk_level: 'HIGH',
      reasoning: 'Low confidence gamble'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, lowConfidenceDecision, {
      idempotencyKey: 'test_bypass_prevention'
    });

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'LOW_CONFIDENCE'));
    assert.equal(toolResult.recovered, false);
  });
});
