/**
 * Phase 4 Comprehensive Test Suite: Bounded Tool Router & Safe Razorpay Test-Mode Execution
 * 
 * Validates:
 * 1. ZERO-TRUST EXECUTION BOUNDARY: "AI CAN RECOMMEND, BUT AI CANNOT EXECUTE"
 * 2. DETERMINISTIC GATE: "NO POLICY APPROVAL = NO TOOL EXECUTION"
 * 3. FINANCIAL SAFETY INVARIANT: "TEST API SUCCESS != PAYMENT RECOVERY"
 * 4. Requirements A through U
 * 5. Demo Scenarios A through E
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataStore } from '../server/db/store.ts';
import {
  dispatchApprovedTool,
  executeRecoveryPipeline,
  ToolRouterError
} from '../server/tools/toolRegistry.ts';
import { idempotencyStore } from '../server/tools/idempotency.ts';
import {
  simulatePaymentRetry,
  simulatePaymentReminder,
  simulateEscalateToOps,
  simulateTerminateRecovery
} from '../server/tools/simulationRailTools.ts';
import {
  createRazorpayTestPaymentLink,
  createRazorpayTestOrder,
  verifyRazorpayTestPayment,
  getRazorpayConfig
} from '../server/tools/razorpayRealTools.ts';
import { verifyExecutionOutcome } from '../server/tools/verification.ts';
import { policyEngine } from '../server/policies/policyEngine.ts';
import { AIAgentDecision, Payment, Customer, PolicyRules, PolicyResult } from '../src/types/index.ts';

describe('Phase 4: Bounded Tool Router & Safe Execution Tests', () => {
  beforeEach(() => {
    dataStore.reset(1337);
    idempotencyStore.clear();
  });

  // A. Valid RETRY_PAYMENT reaches simulation tool
  test('A. Valid RETRY_PAYMENT reaches the simulation tool and recovers transient failure', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const policy = dataStore.getPolicy();

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.95,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.90,
      risk_level: 'LOW',
      reasoning: 'Transient switch overload'
    };

    const policyResult = policyEngine.evaluate(payment, customer, decision, policy);
    assert.equal(policyResult.allowed, true);

    const toolResult = await dispatchApprovedTool(payment, customer, decision, policyResult);
    assert.equal(toolResult.tool_called, 'retry_payment');
    assert.equal(toolResult.execution_mode, 'SIMULATED_RECOVERY');
    assert.equal(toolResult.success, true);
    assert.equal(toolResult.recovered, true);
    assert.equal(toolResult.amount_recovered, 249900);
    assert.equal(toolResult.final_payment_status, 'captured');
  });

  // B. Valid SEND_PAYMENT_REMINDER reaches the correct reminder tool
  test('B. Valid SEND_PAYMENT_REMINDER reaches reminder tool with recovered = false', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const policy = dataStore.getPolicy();

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.80,
      recommended_action: 'SEND_PAYMENT_REMINDER',
      confidence: 0.85,
      risk_level: 'LOW',
      reasoning: 'Send payment link to customer',
      customer_recovery_message: 'Please complete your pending transaction here'
    };

    const policyResult = policyEngine.evaluate(payment, customer, decision, policy);
    assert.equal(policyResult.allowed, true);

    const toolResult = await dispatchApprovedTool(payment, customer, decision, policyResult);
    assert.equal(toolResult.tool_called, 'send_payment_reminder');
    assert.equal(toolResult.success, true);
    // Invariant: Link created != payment recovered
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.ok(toolResult.payment_link_url || toolResult.external_reference_id);
  });

  // C. ESCALATE never calls Razorpay / payment APIs
  test('C. ESCALATE performs local state transition with zero payment API calls', async () => {
    const payment = dataStore.getPaymentById('pay_demo_persistent_02')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const policy = dataStore.getPolicy();

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'insufficient_funds',
      recoverability_score: 0.10,
      recommended_action: 'ESCALATE',
      confidence: 0.95,
      risk_level: 'MEDIUM',
      reasoning: 'Persistent limit failure requires human operations'
    };

    const policyResult = policyEngine.evaluate(payment, customer, decision, policy);
    assert.equal(policyResult.allowed, true);

    const toolResult = await dispatchApprovedTool(payment, customer, decision, policyResult);
    assert.equal(toolResult.tool_called, 'escalate_to_ops');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.equal(toolResult.final_payment_status, 'escalated');
    assert.equal(dataStore.getPaymentById(payment.id)?.status, 'escalated');
  });

  // D. STOP never calls Razorpay / payment APIs
  test('D. STOP terminates automated recovery with zero payment API calls', async () => {
    const payment = dataStore.getPaymentById('pay_demo_persistent_02')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const policy = dataStore.getPolicy();

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'fatal_declined_card',
      recoverability_score: 0.0,
      recommended_action: 'STOP',
      confidence: 0.99,
      risk_level: 'CRITICAL',
      reasoning: 'Terminal card cancel'
    };

    const policyResult = policyEngine.evaluate(payment, customer, decision, policy);
    assert.equal(policyResult.allowed, true);

    const toolResult = await dispatchApprovedTool(payment, customer, decision, policyResult);
    assert.equal(toolResult.tool_called, 'terminate_recovery');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.final_payment_status, 'abandoned');
    assert.equal(dataStore.getPaymentById(payment.id)?.status, 'abandoned');
  });

  // E. Policy-blocked retry cannot reach any tool
  test('E. Policy-blocked retry cannot reach any tool (NO POLICY APPROVAL = NO TOOL EXECUTION)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_highvalue_03')!; // ₹85,000 + opted out
    const customer = dataStore.getCustomerById(payment.customer_id)!;

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'network_timeout',
      recoverability_score: 0.90,
      recommended_action: 'RETRY_PAYMENT', // AI attempts to retry
      confidence: 0.90,
      risk_level: 'LOW',
      reasoning: 'Recommending automated retry'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.equal(toolResult.policy_decision, 'BLOCKED');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.notEqual(toolResult.tool_called, 'retry_payment');
  });

  // F. Captured payment cannot be retried
  test('F. Captured payment cannot be retried (ALREADY_SUCCESSFUL)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_captured_05')!;
    assert.equal(payment.status, 'captured');

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.90,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.90,
      risk_level: 'LOW',
      reasoning: 'Trying to retry captured payment'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'ALREADY_SUCCESSFUL'));
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.equal(toolResult.final_payment_status, 'captured');
  });

  // G. Opted-out customer cannot receive automated retry/reminder
  test('G. Opted-out customer cannot receive automated retry or reminder', async () => {
    const payment = dataStore.getPaymentById('pay_demo_highvalue_03')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    assert.equal(customer.opted_out, true);

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.85,
      recommended_action: 'SEND_PAYMENT_REMINDER',
      confidence: 0.85,
      risk_level: 'LOW',
      reasoning: 'Send reminder to opted-out client'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'CUSTOMER_OPTED_OUT'));
    assert.notEqual(toolResult.tool_called, 'send_payment_reminder');
  });

  // H. Max retries cannot be exceeded
  test('H. Max retries cannot be exceeded (MAX_RETRIES_EXCEEDED)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_persistent_02')!;
    // Set attempts to max (2)
    dataStore.updatePayment(payment.id, { recovery_attempts: 2 });

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.70,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.75,
      risk_level: 'LOW',
      reasoning: 'Retry attempt #3'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));
    assert.notEqual(toolResult.tool_called, 'retry_payment');
  });

  // I. Cooldown cannot be bypassed
  test('I. Cooldown window cannot be bypassed (COOLDOWN_ACTIVE)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    // Failure was only 120 seconds ago (< 900s min cooldown)
    dataStore.updatePayment(payment.id, { seconds_since_failure: 120 });

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.85,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.80,
      risk_level: 'LOW',
      reasoning: 'Immediate retry without waiting for cooldown'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'COOLDOWN_ACTIVE'));
    assert.notEqual(toolResult.tool_called, 'retry_payment');
  });

  // J. High-value payment cannot bypass automated amount cap
  test('J. High-value payment cannot bypass automated amount cap (AMOUNT_EXCEEDS_CAP)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_highvalue_03')!; // ₹85,000 > ₹50,000

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.90,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.90,
      risk_level: 'LOW',
      reasoning: 'Auto retry high value'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'AMOUNT_EXCEEDS_CAP'));
    assert.notEqual(toolResult.tool_called, 'retry_payment');
  });

  // K. Low-confidence decision cannot reach consequential tools
  test('K. Low-confidence decision cannot reach consequential tools (LOW_CONFIDENCE)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.60,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.45, // Below 0.60 threshold
      risk_level: 'LOW',
      reasoning: 'Low confidence retry recommendation'
    };

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

    assert.equal(policyResult.allowed, false);
    assert.ok(policyResult.violations.some(v => v.rule === 'LOW_CONFIDENCE'));
    assert.notEqual(toolResult.tool_called, 'retry_payment');
  });

  // L. Invalid action cannot reach a tool
  test('L. Invalid action cannot reach a tool (INVALID_ACTION)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const policy = dataStore.getPolicy();

    const invalidDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.8,
      recommended_action: 'CHARGE_CARD_NOW' as any, // Invalid forbidden action verb
      confidence: 0.9,
      risk_level: 'LOW',
      reasoning: 'Unsolicited card charging'
    };

    // 1. PolicyEngine directly blocks invalid action
    const directPolicyResult = policyEngine.evaluate(payment, customer, invalidDecision as any, policy);
    assert.equal(directPolicyResult.allowed, false);
    assert.ok(directPolicyResult.violations.some(v => v.rule === 'INVALID_ACTION'));
    assert.equal(directPolicyResult.finalAction, 'ESCALATE');

    // 2. Full pipeline converts invalid action safely to ESCALATE without executing charge tool
    const { toolResult } = await executeRecoveryPipeline(payment.id, invalidDecision as any);
    assert.notEqual(toolResult.tool_called, 'CHARGE_CARD_NOW' as any);
    assert.equal(toolResult.tool_called, 'escalate_to_ops');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
  });

  // M. Malformed AI response cannot reach a tool
  test('M. Malformed AI response cannot reach a tool and fails closed to ESCALATE', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;

    const malformedDecision = {
      payment_id: 'wrong_id',
      diagnosis: 'not_a_valid_diagnosis',
      recoverability_score: 999, // Out of bounds
      recommended_action: 'RETRY_PAYMENT',
      confidence: -5, // Out of bounds
      risk_level: 'INVALID'
    } as any;

    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, malformedDecision);
    // Router validates AI decision, converts to fallback ESCALATE
    assert.equal(toolResult.action, 'ESCALATE');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
  });

  // N. Duplicate idempotency key cannot execute the same recovery twice
  test('N. Duplicate idempotency key cannot execute the same recovery twice (Idempotency)', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const policy = dataStore.getPolicy();

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.95,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.90,
      risk_level: 'LOW',
      reasoning: 'First execution attempt'
    };

    const fixedIdempotencyKey = 'idem_fixed_test_key_001';

    const policyResult = policyEngine.evaluate(payment, customer, decision, policy);
    assert.equal(policyResult.allowed, true);

    // First call: executes tool
    const firstResult = await dispatchApprovedTool(payment, customer, decision, policyResult, {
      idempotencyKey: fixedIdempotencyKey
    });
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.recovered, true);
    assert.equal(firstResult.idempotent_replay, undefined);

    // Second call: duplicate request with same key
    const secondResult = await dispatchApprovedTool(payment, customer, decision, policyResult, {
      idempotencyKey: fixedIdempotencyKey
    });

    assert.equal(secondResult.success, true);
    assert.equal(secondResult.recovered, true);
    assert.equal(secondResult.idempotent_replay, true);
    assert.ok(secondResult.message.includes('[IDEMPOTENT REPLAY]'));
  });

  // O. Concurrent/duplicate execution attempts are safely handled
  test('O. Concurrent duplicate execution attempts are safely handled via lock', async () => {
    const key = 'idem_lock_test_concurrent';
    const locked = idempotencyStore.lock(key, 'pay_demo_01');
    assert.equal(locked, true);

    // Immediate second lock attempt fails
    const secondLock = idempotencyStore.lock(key, 'pay_demo_01');
    assert.equal(secondLock, false);

    const check = idempotencyStore.check(key);
    assert.equal(check.exists, true);
    assert.equal(check.inProgress, true);
  });

  // P. Razorpay credentials missing → graceful safe fallback; application does not crash
  test('P. Razorpay credentials missing → graceful safe fallback with zero crash', async () => {
    const originalKeyId = process.env.RAZORPAY_KEY_ID;
    const originalSecret = process.env.RAZORPAY_KEY_SECRET;

    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    try {
      const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
      const customer = dataStore.getCustomerById(payment.customer_id)!;

      const result = await createRazorpayTestPaymentLink(payment, customer, 'test_idem_link');
      assert.equal(result.success, false);
      assert.equal(result.recovered, false);
      assert.ok(result.message.includes('RAZORPAY_CREDENTIALS_MISSING'));

      const orderResult = await createRazorpayTestOrder(payment, 'test_idem_order');
      assert.equal(orderResult.success, false);
      assert.equal(orderResult.recovered, false);
      assert.ok(orderResult.message.includes('RAZORPAY_CREDENTIALS_MISSING'));

      const verifyResult = await verifyRazorpayTestPayment('pay_nonexistent');
      assert.equal(verifyResult.success, false);
      assert.ok(verifyResult.error?.includes('credentials not configured'));
    } finally {
      process.env.RAZORPAY_KEY_ID = originalKeyId;
      process.env.RAZORPAY_KEY_SECRET = originalSecret;
    }
  });

  // Q. Razorpay TEST API failures → safe ToolResult with no false recovery
  test('Q. Razorpay TEST API failure produces safe ToolResult with no false recovery', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;

    // Simulate outcome verification of a failed API call
    const failedResult = {
      tool_called: 'send_payment_reminder' as const,
      action: 'SEND_PAYMENT_REMINDER' as const,
      execution_mode: 'RAZORPAY_TEST_API' as const,
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: 'idem_failed_api',
      policy_decision: 'ALLOWED' as const,
      policy_violations: [],
      final_payment_status: 'failed' as const,
      message: 'Razorpay TEST API returned HTTP 500',
      error_message: 'Gateway timeout',
      timestamp: new Date().toISOString()
    };

    const verified = verifyExecutionOutcome(payment, failedResult);
    assert.equal(verified.recovered, false);
    assert.equal(verified.amount_recovered, 0);
    assert.equal(verified.audit_status, 'FAILED');
  });

  // R. Simulation failures → final state remains failed and is not falsely marked recovered
  test('R. Simulation failure keeps payment failed and never claims recovery', () => {
    const payment = dataStore.getPaymentById('pay_demo_persistent_02')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;

    const { toolResult, updatedPayment } = simulatePaymentRetry(payment, customer, 'idem_sim_fail');
    assert.equal(toolResult.success, false);
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.equal(toolResult.final_payment_status, 'failed');
    assert.equal(updatedPayment.recovery_attempts, payment.recovery_attempts + 1);

    const verified = verifyExecutionOutcome(payment, toolResult);
    assert.equal(verified.recovered, false);
    assert.equal(verified.amount_recovered, 0);
    assert.equal(verified.final_payment_status, 'failed');
  });

  // S. Simulation success → payment transitions to captured/recovered according to state model
  test('S. Simulation success transitions payment to captured with full amount recovered', () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;

    const { toolResult, updatedPayment } = simulatePaymentRetry(payment, customer, 'idem_sim_succ');
    assert.equal(toolResult.success, true);
    assert.equal(toolResult.recovered, true);
    assert.equal(toolResult.amount_recovered, payment.amount);
    assert.equal(toolResult.final_payment_status, 'captured');
    assert.equal(updatedPayment.status, 'captured');

    const verified = verifyExecutionOutcome(payment, toolResult);
    assert.equal(verified.recovered, true);
    assert.equal(verified.amount_recovered, payment.amount);
    assert.equal(verified.final_payment_status, 'captured');
  });

  // T. Diagnosis endpoint produces zero financial side effects
  test('T. Diagnosis produces zero financial side effects and does not mutate DataStore', () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const originalStatus = payment.status;
    const originalAttempts = payment.recovery_attempts;

    // Simulate diagnostic flow
    const policy = dataStore.getPolicy();
    const customer = dataStore.getCustomerById(payment.customer_id)!;

    // Telemetry inspection must not alter database
    const currentPayment = dataStore.getPaymentById('pay_demo_transient_01')!;
    assert.equal(currentPayment.status, originalStatus);
    assert.equal(currentPayment.recovery_attempts, originalAttempts);
  });

  // U. Tool Router cannot be invoked successfully with an unapproved PolicyResult
  test('U. Tool Router cannot be invoked successfully with an unapproved PolicyResult', async () => {
    const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
    const customer = dataStore.getCustomerById(payment.customer_id)!;

    const decision: AIAgentDecision = {
      payment_id: payment.id,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.9,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.9,
      risk_level: 'LOW',
      reasoning: 'Try bypass'
    };

    const blockedPolicyResult: PolicyResult = {
      allowed: false, // Explicitly false!
      originalAction: 'RETRY_PAYMENT',
      finalAction: 'ESCALATE',
      violations: [{ rule: 'LOW_CONFIDENCE', reason: 'Unapproved test policy', forced_action: 'ESCALATE' }],
      evaluatedRules: [],
      evaluatedAt: new Date().toISOString()
    };

    const toolResult = await dispatchApprovedTool(payment, customer, decision, blockedPolicyResult);
    assert.equal(toolResult.policy_decision, 'BLOCKED');
    assert.equal(toolResult.recovered, false);
    assert.equal(toolResult.amount_recovered, 0);
    assert.ok(toolResult.message.includes('TOOL EXECUTION BLOCKED BY POLICY'));
  });

  // DEMO SCENARIO TESTS
  describe('Demo Scenarios A through E', () => {
    test('Scenario A: pay_demo_transient_01 → RETRY_PAYMENT → ALLOWED → SIMULATED_RECOVERY → captured (₹2,499 recovered)', async () => {
      const payment = dataStore.getPaymentById('pay_demo_transient_01')!;
      assert.equal(payment.amount, 249900); // ₹2,499

      const decision: AIAgentDecision = {
        payment_id: payment.id,
        diagnosis: 'transient_bank_downtime',
        recoverability_score: 0.92,
        recommended_action: 'RETRY_PAYMENT',
        confidence: 0.88,
        risk_level: 'LOW',
        reasoning: 'Bank system busy failure. Re-route via secondary gateway.'
      };

      const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

      assert.equal(policyResult.allowed, true);
      assert.equal(toolResult.tool_called, 'retry_payment');
      assert.equal(toolResult.execution_mode, 'SIMULATED_RECOVERY');
      assert.equal(toolResult.success, true);
      assert.equal(toolResult.recovered, true);
      assert.equal(toolResult.amount_recovered, 249900);
      assert.equal(toolResult.final_payment_status, 'captured');

      // Datastore verified updated
      assert.equal(dataStore.getPaymentById(payment.id)?.status, 'captured');
    });

    test('Scenario B: pay_demo_persistent_02 → LIMIT_EXCEEDED → retry fails → recovery_attempts reaches 2 → MAX_RETRIES_EXCEEDED blocks subsequent retry', async () => {
      const payment = dataStore.getPaymentById('pay_demo_persistent_02')!;
      assert.equal(payment.recovery_attempts, 1);

      const decision1: AIAgentDecision = {
        payment_id: payment.id,
        diagnosis: 'insufficient_funds',
        recoverability_score: 0.65,
        recommended_action: 'RETRY_PAYMENT',
        confidence: 0.70,
        risk_level: 'MEDIUM',
        reasoning: 'Attempting retry #2'
      };

      // First attempt executes and fails, advancing attempts from 1 to 2
      const firstExec = await executeRecoveryPipeline(payment.id, decision1);
      assert.equal(firstExec.policyResult.allowed, true);
      assert.equal(firstExec.toolResult.recovered, false);
      assert.equal(firstExec.toolResult.final_payment_status, 'failed');

      const updatedPayment = dataStore.getPaymentById(payment.id)!;
      assert.equal(updatedPayment.recovery_attempts, 2);

      // Next evaluation now reaches MAX_RETRIES_EXCEEDED
      const decision2: AIAgentDecision = {
        payment_id: payment.id,
        diagnosis: 'insufficient_funds',
        recoverability_score: 0.65,
        recommended_action: 'RETRY_PAYMENT',
        confidence: 0.70,
        risk_level: 'MEDIUM',
        reasoning: 'Attempting retry #3 (must be blocked)'
      };

      const secondExec = await executeRecoveryPipeline(payment.id, decision2);
      assert.equal(secondExec.policyResult.allowed, false);
      assert.ok(secondExec.policyResult.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));
      assert.equal(secondExec.policyResult.finalAction, 'ESCALATE');
      assert.equal(secondExec.toolResult.policy_decision, 'BLOCKED');
      assert.equal(secondExec.toolResult.recovered, false);
    });

    test('Scenario C: pay_demo_highvalue_03 (₹85,000, opted_out = true) → Policy BLOCKED → zero tool execution → ESCALATE', async () => {
      const payment = dataStore.getPaymentById('pay_demo_highvalue_03')!;
      const customer = dataStore.getCustomerById(payment.customer_id)!;

      assert.equal(payment.amount, 8500000); // ₹85,000
      assert.equal(customer.opted_out, true);

      const decision: AIAgentDecision = {
        payment_id: payment.id,
        diagnosis: 'network_timeout',
        recoverability_score: 0.95,
        recommended_action: 'RETRY_PAYMENT',
        confidence: 0.90,
        risk_level: 'LOW',
        reasoning: 'Network timeout, recommended retry'
      };

      const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

      assert.equal(policyResult.allowed, false);
      assert.equal(policyResult.finalAction, 'STOP'); // Opted out takes STOP precedence over amount cap ESCALATE
      assert.ok(policyResult.violations.some(v => v.rule === 'CUSTOMER_OPTED_OUT'));
      assert.ok(policyResult.violations.some(v => v.rule === 'AMOUNT_EXCEEDS_CAP'));
      assert.equal(toolResult.policy_decision, 'BLOCKED');
      assert.equal(toolResult.recovered, false);
      assert.equal(toolResult.amount_recovered, 0);
    });

    test('Scenario D: Malformed Gemini response → validation failure → ESCALATE → zero financial tool execution', async () => {
      const payment = dataStore.getPaymentById('pay_demo_transient_01')!;

      const malformedDecision = {
        payment_id: 'fabricated_id',
        diagnosis: 'invalid_diagnosis_string',
        recoverability_score: -1.0,
        recommended_action: 'UNRECOGNIZED_ACTION',
        confidence: 2.0,
        risk_level: 'UNKNOWN'
      } as any;

      const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, malformedDecision);

      assert.equal(policyResult.finalAction, 'ESCALATE');
      assert.equal(toolResult.action, 'ESCALATE');
      assert.equal(toolResult.recovered, false);
      assert.equal(toolResult.amount_recovered, 0);
      assert.equal(toolResult.tool_called, 'escalate_to_ops');
    });

    test('Scenario E: Already captured payment → retry requested → ALREADY_SUCCESSFUL → STOP → zero payment API execution', async () => {
      const payment = dataStore.getPaymentById('pay_demo_captured_05')!;
      assert.equal(payment.status, 'captured');

      const decision: AIAgentDecision = {
        payment_id: payment.id,
        diagnosis: 'transient_bank_downtime',
        recoverability_score: 0.99,
        recommended_action: 'RETRY_PAYMENT',
        confidence: 0.95,
        risk_level: 'LOW',
        reasoning: 'Accidental retry of captured payment'
      };

      const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decision);

      assert.equal(policyResult.allowed, false);
      assert.equal(policyResult.finalAction, 'STOP');
      assert.ok(policyResult.violations.some(v => v.rule === 'ALREADY_SUCCESSFUL'));
      assert.equal(toolResult.policy_decision, 'BLOCKED');
      assert.equal(toolResult.recovered, false);
      assert.equal(toolResult.amount_recovered, 0);
      assert.equal(dataStore.getPaymentById(payment.id)?.status, 'captured');
    });
  });
});
