/**
 * Unit Tests for RecoverPay Deterministic Policy Engine
 * Tests normal approvals, safety blocks, boundary edges, and multiple violations.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { policyEngine } from '../server/policies/policyEngine.ts';
import {
  Payment,
  Customer,
  AIAgentDecision,
  PolicyRules,
  RecoveryAction
} from '../src/types/index.ts';

// Baseline fixtures
const BASE_POLICY: PolicyRules = {
  id: 'pol_test',
  max_retries: 2,
  max_automated_recovery_amount: 5000000, // ₹50,000 in paise
  min_retry_cooldown_seconds: 900,        // 15 minutes
  do_not_retry_after_success: true,
  do_not_retry_if_customer_opted_out: true,
  low_confidence_threshold: 0.60
};

const BASE_CUSTOMER: Customer = {
  id: 'cust_test_01',
  name: 'Test Merchant Customer',
  email: 'customer@test.internal',
  contact: '+919800000000',
  lifetime_value: 1000000,
  previous_success_count: 10,
  previous_failure_count: 1,
  historical_success_rate: 0.90,
  opted_out: false,
  created_at: '2026-08-01T00:00:00.000Z'
};

const BASE_PAYMENT: Payment = {
  id: 'pay_test_01',
  customer_id: 'cust_test_01',
  order_id: 'order_test_01',
  amount: 249900, // ₹2,499.00
  currency: 'INR',
  status: 'failed',
  failure_category: 'TRANSIENT_BANK_FAILURE',
  failure_code: 'BANK_SYSTEM_BUSY',
  failure_reason: 'Issuer switch returned 504 server busy timeout',
  attempt_count: 1,
  recovery_attempts: 0,
  seconds_since_failure: 1200, // 20 minutes (cooldown satisfied)
  last_attempt_at: '2026-09-04T19:40:00.000Z',
  created_at: '2026-09-04T19:39:00.000Z',
  updated_at: '2026-09-04T19:40:00.000Z',
  ground_truth_recoverable: true,
  ground_truth_best_action: 'RETRY_PAYMENT',
  ground_truth_expected_outcome: 'RECOVERED',
  ground_truth_reason: 'Transient failure recoverable with retry'
};

const BASE_DECISION: AIAgentDecision = {
  payment_id: 'pay_test_01',
  diagnosis: 'transient_bank_downtime',
  recoverability_score: 0.92,
  recommended_action: 'RETRY_PAYMENT',
  confidence: 0.91,
  risk_level: 'LOW',
  reasoning: 'Transient failure with strong customer payment history'
};

describe('Policy Engine: Normal Approvals', () => {
  test('Valid RETRY_PAYMENT proposal is ALLOWED', () => {
    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'RETRY_PAYMENT');
    assert.equal(result.violations.length, 0);
    assert.equal(result.evaluatedRules.length, 8);
    assert.ok(result.evaluatedRules.every(r => r.passed));
  });

  test('Valid SEND_PAYMENT_REMINDER proposal is ALLOWED', () => {
    const decision: AIAgentDecision = {
      ...BASE_DECISION,
      recommended_action: 'SEND_PAYMENT_REMINDER',
      customer_recovery_message: 'Your payment could not be processed. Please click here to retry.'
    };
    const payment: Payment = {
      ...BASE_PAYMENT,
      failure_category: 'INSUFFICIENT_FUNDS'
    };

    const result = policyEngine.evaluate(payment, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'SEND_PAYMENT_REMINDER');
    assert.equal(result.violations.length, 0);
  });

  test('Valid ESCALATE proposal is ALLOWED', () => {
    const decision: AIAgentDecision = {
      ...BASE_DECISION,
      recommended_action: 'ESCALATE',
      confidence: 0.70
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.equal(result.violations.length, 0);
  });

  test('Valid STOP proposal is ALLOWED', () => {
    const decision: AIAgentDecision = {
      ...BASE_DECISION,
      recommended_action: 'STOP',
      confidence: 0.95
    };
    const payment: Payment = {
      ...BASE_PAYMENT,
      failure_category: 'FATAL_DECLINE'
    };

    const result = policyEngine.evaluate(payment, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'STOP');
    assert.equal(result.violations.length, 0);
  });
});

describe('Policy Engine: Safety Blocks', () => {
  test('Rule 1: ALREADY_SUCCESSFUL blocks retry on captured payment and forces STOP', () => {
    const payment: Payment = {
      ...BASE_PAYMENT,
      status: 'captured'
    };

    const result = policyEngine.evaluate(payment, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'STOP');
    assert.ok(result.violations.some(v => v.rule === 'ALREADY_SUCCESSFUL'));
  });

  test('Rule 2: CUSTOMER_OPTED_OUT blocks automated action and forces STOP', () => {
    const customer: Customer = {
      ...BASE_CUSTOMER,
      opted_out: true
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, customer, BASE_DECISION, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'STOP');
    assert.ok(result.violations.some(v => v.rule === 'CUSTOMER_OPTED_OUT'));
  });

  test('Rule 3: MAX_RETRIES_EXCEEDED blocks retry when attempts >= limit and forces ESCALATE', () => {
    const payment: Payment = {
      ...BASE_PAYMENT,
      recovery_attempts: 2 // equal to policy.max_retries
    };

    const result = policyEngine.evaluate(payment, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));
  });

  test('Rule 4: COOLDOWN_ACTIVE blocks retry when cooldown window not elapsed and forces ESCALATE', () => {
    const payment: Payment = {
      ...BASE_PAYMENT,
      seconds_since_failure: 300 // 5 minutes < 15 minutes (900s)
    };

    const result = policyEngine.evaluate(payment, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'COOLDOWN_ACTIVE'));
  });

  test('Rule 5: AMOUNT_EXCEEDS_CAP blocks retry on high value and forces ESCALATE', () => {
    const payment: Payment = {
      ...BASE_PAYMENT,
      amount: 7500000 // ₹75,000 in paise > ₹50,000 cap
    };

    const result = policyEngine.evaluate(payment, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'AMOUNT_EXCEEDS_CAP'));
  });

  test('Rule 6: LOW_CONFIDENCE blocks when confidence < threshold and forces ESCALATE', () => {
    const decision: AIAgentDecision = {
      ...BASE_DECISION,
      confidence: 0.52 // < 0.60
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'LOW_CONFIDENCE'));
  });

  test('Rule 7: INVALID_ACTION blocks unrecognized action verbs and forces ESCALATE', () => {
    const decision = {
      ...BASE_DECISION,
      recommended_action: 'DIRECT_DEBIT_UNAUTHORIZED' as any
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'INVALID_ACTION'));
  });

  test('Rule 8: MALFORMED_OUTPUT handles null, undefined, or missing fields and forces ESCALATE', () => {
    const malformedDecision = {
      diagnosis: 'broken'
    } as any;

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, malformedDecision, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'MALFORMED_OUTPUT'));
  });
});

describe('Policy Engine: Precise Boundary Tests', () => {
  test('Boundary: Confidence threshold (0.59 vs 0.60 vs 0.61)', () => {
    // 0.59 -> Below threshold (Blocked)
    const d59: AIAgentDecision = { ...BASE_DECISION, confidence: 0.59 };
    const r59 = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, d59, BASE_POLICY);
    assert.equal(r59.allowed, false, 'Confidence 0.59 should be BLOCKED');
    assert.ok(r59.violations.some(v => v.rule === 'LOW_CONFIDENCE'));

    // 0.60 -> Exact threshold (Allowed, equality is permitted)
    const d60: AIAgentDecision = { ...BASE_DECISION, confidence: 0.60 };
    const r60 = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, d60, BASE_POLICY);
    assert.equal(r60.allowed, true, 'Confidence 0.60 should be ALLOWED');

    // 0.61 -> Above threshold (Allowed)
    const d61: AIAgentDecision = { ...BASE_DECISION, confidence: 0.61 };
    const r61 = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, d61, BASE_POLICY);
    assert.equal(r61.allowed, true, 'Confidence 0.61 should be ALLOWED');
  });

  test('Refined LOW_CONFIDENCE: Low confidence with non-automated actions (STOP / ESCALATE) is ALLOWED', () => {
    // Low confidence + STOP -> Allowed as STOP (Safe shutdown preserved)
    const dStopLow: AIAgentDecision = {
      ...BASE_DECISION,
      recommended_action: 'STOP',
      confidence: 0.35
    };
    const rStop = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, dStopLow, BASE_POLICY);
    assert.equal(rStop.allowed, true, 'Low confidence STOP should be ALLOWED');
    assert.equal(rStop.finalAction, 'STOP');
    assert.ok(!rStop.violations.some(v => v.rule === 'LOW_CONFIDENCE'));

    // Low confidence + ESCALATE -> Allowed as ESCALATE (Human escalation preserved)
    const dEscalateLow: AIAgentDecision = {
      ...BASE_DECISION,
      recommended_action: 'ESCALATE',
      confidence: 0.25
    };
    const rEscalate = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, dEscalateLow, BASE_POLICY);
    assert.equal(rEscalate.allowed, true, 'Low confidence ESCALATE should be ALLOWED');
    assert.equal(rEscalate.finalAction, 'ESCALATE');
    assert.ok(!rEscalate.violations.some(v => v.rule === 'LOW_CONFIDENCE'));

    // Low confidence + SEND_PAYMENT_REMINDER -> BLOCKED -> ESCALATE (Automated action blocked)
    const dReminderLow: AIAgentDecision = {
      ...BASE_DECISION,
      recommended_action: 'SEND_PAYMENT_REMINDER',
      confidence: 0.40
    };
    const rReminder = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, dReminderLow, BASE_POLICY);
    assert.equal(rReminder.allowed, false, 'Low confidence SEND_PAYMENT_REMINDER should be BLOCKED');
    assert.equal(rReminder.finalAction, 'ESCALATE');
    assert.ok(rReminder.violations.some(v => v.rule === 'LOW_CONFIDENCE'));
  });

  test('Boundary: Recovery attempts (1 vs 2 vs 3 with max_retries = 2)', () => {
    // 1 attempt -> Under limit (Allowed)
    const p1: Payment = { ...BASE_PAYMENT, recovery_attempts: 1 };
    const r1 = policyEngine.evaluate(p1, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r1.allowed, true, 'Attempts 1 < 2 should be ALLOWED');

    // 2 attempts -> At limit (Blocked, attempts >= max_retries)
    const p2: Payment = { ...BASE_PAYMENT, recovery_attempts: 2 };
    const r2 = policyEngine.evaluate(p2, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r2.allowed, false, 'Attempts 2 >= 2 should be BLOCKED');
    assert.ok(r2.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));

    // 3 attempts -> Exceeded limit (Blocked)
    const p3: Payment = { ...BASE_PAYMENT, recovery_attempts: 3 };
    const r3 = policyEngine.evaluate(p3, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r3.allowed, false, 'Attempts 3 > 2 should be BLOCKED');
    assert.ok(r3.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));
  });

  test('Boundary: Amount cap (₹49,999 vs ₹50,000 vs ₹50,001 with cap ₹50,000)', () => {
    // ₹49,999 = 4,999,900 paise -> Under cap (Allowed)
    const p49k: Payment = { ...BASE_PAYMENT, amount: 4999900 };
    const r49k = policyEngine.evaluate(p49k, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r49k.allowed, true, 'Amount ₹49,999 should be ALLOWED');

    // ₹50,000 = 5,000,000 paise -> At cap (Allowed, <= cap is permitted)
    const p50k: Payment = { ...BASE_PAYMENT, amount: 5000000 };
    const r50k = policyEngine.evaluate(p50k, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r50k.allowed, true, 'Amount ₹50,000 should be ALLOWED');

    // ₹50,001 = 5,000,100 paise -> Over cap (Blocked)
    const p50k1: Payment = { ...BASE_PAYMENT, amount: 5000100 };
    const r50k1 = policyEngine.evaluate(p50k1, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r50k1.allowed, false, 'Amount ₹50,001 should be BLOCKED');
    assert.ok(r50k1.violations.some(v => v.rule === 'AMOUNT_EXCEEDS_CAP'));
  });

  test('Boundary: Cooldown window (899s vs 900s vs 901s with min_cooldown = 900s)', () => {
    // 899s -> 1 second remaining in cooldown (Blocked)
    const p899: Payment = { ...BASE_PAYMENT, seconds_since_failure: 899 };
    const r899 = policyEngine.evaluate(p899, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r899.allowed, false, 'Cooldown 899s should be BLOCKED');
    assert.ok(r899.violations.some(v => v.rule === 'COOLDOWN_ACTIVE'));

    // 900s -> Exact cooldown elapsed (Allowed, >= requirement)
    const p900: Payment = { ...BASE_PAYMENT, seconds_since_failure: 900 };
    const r900 = policyEngine.evaluate(p900, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r900.allowed, true, 'Cooldown 900s should be ALLOWED');

    // 901s -> Elapsed past cooldown (Allowed)
    const p901: Payment = { ...BASE_PAYMENT, seconds_since_failure: 901 };
    const r901 = policyEngine.evaluate(p901, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);
    assert.equal(r901.allowed, true, 'Cooldown 901s should be ALLOWED');
  });
});

describe('Policy Engine: Multiple Simultaneous Violations', () => {
  test('Multiple violations captured simultaneously without early termination', () => {
    const customer: Customer = {
      ...BASE_CUSTOMER,
      opted_out: true // Violation: CUSTOMER_OPTED_OUT
    };

    const payment: Payment = {
      ...BASE_PAYMENT,
      amount: 8500000,        // ₹85,000 -> Violation: AMOUNT_EXCEEDS_CAP
      recovery_attempts: 2,   // Limit reached -> Violation: MAX_RETRIES_EXCEEDED
      seconds_since_failure: 300 // Cooldown active -> Violation: COOLDOWN_ACTIVE
    };

    const decision: AIAgentDecision = {
      ...BASE_DECISION,
      confidence: 0.45        // Low confidence -> Violation: LOW_CONFIDENCE
    };

    const result = policyEngine.evaluate(payment, customer, decision, BASE_POLICY);

    assert.equal(result.allowed, false);
    assert.equal(result.originalAction, 'RETRY_PAYMENT');
    // Because customer opted out, STOP takes precedence over ESCALATE
    assert.equal(result.finalAction, 'STOP');

    // Verify all 5 violations are captured in result
    const violatedRuleNames = result.violations.map(v => v.rule);
    assert.ok(violatedRuleNames.includes('CUSTOMER_OPTED_OUT'));
    assert.ok(violatedRuleNames.includes('AMOUNT_EXCEEDS_CAP'));
    assert.ok(violatedRuleNames.includes('MAX_RETRIES_EXCEEDED'));
    assert.ok(violatedRuleNames.includes('COOLDOWN_ACTIVE'));
    assert.ok(violatedRuleNames.includes('LOW_CONFIDENCE'));
    assert.equal(result.violations.length, 5, 'Expected exactly 5 violations');
  });
});

describe('Policy Engine: Zero-Execution Architecture Proof', () => {
  test('Policy engine returns decision metadata only, with zero financial side-effects', () => {
    const paymentBefore = { ...BASE_PAYMENT };
    const customerBefore = { ...BASE_CUSTOMER };

    // AI proposed RETRY_PAYMENT on maxed attempts
    const paymentBlocked: Payment = { ...BASE_PAYMENT, recovery_attempts: 2 };
    const result = policyEngine.evaluate(paymentBlocked, BASE_CUSTOMER, BASE_DECISION, BASE_POLICY);

    // Assert decision is BLOCKED and forced to ESCALATE
    assert.equal(result.allowed, false);
    assert.equal(result.originalAction, 'RETRY_PAYMENT');
    assert.equal(result.finalAction, 'ESCALATE');

    // Assert inputs were completely immutable (zero in-place mutation or execution side effects)
    assert.deepEqual(BASE_PAYMENT, paymentBefore);
    assert.deepEqual(BASE_CUSTOMER, customerBefore);

    // Verify that result has no function handles or tool execution capability
    assert.equal(typeof (result as any).execute, 'undefined');
    assert.equal(typeof (result as any).retryPayment, 'undefined');
    assert.equal(typeof (result as any).callRazorpay, 'undefined');
  });
});
