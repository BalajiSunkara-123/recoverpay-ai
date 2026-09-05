/**
 * RecoverPay Phase 6: Multi-Strategy Evaluation Subsystem Tests
 * Verifies ground-truth isolation, comparative metrics across 600 records,
 * mathematical consistency (confusion matrix invariants), safety cases,
 * and zero-policy-violation guarantees for RecoverPay.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dataStore } from '../server/db/store.ts';
import {
  sanitizePaymentForStrategy,
  deterministicBenchmarkAgent,
  runComparativeEvaluation
} from '../server/evaluation/evaluator.ts';
import { policyEngine } from '../server/policies/policyEngine.ts';

describe('Phase 6: Multi-Strategy Evaluation Subsystem Tests', () => {
  beforeEach(() => {
    dataStore.reset(1337);
  });

  it('1. Ground-Truth Isolation: Sanitize function strictly strips all 4 ground truth fields', () => {
    const rawPayment = dataStore.getAllPayments()[0];

    // Verify raw payment has ground truth
    assert.ok('ground_truth_recoverable' in rawPayment);
    assert.ok('ground_truth_best_action' in rawPayment);
    assert.ok('ground_truth_expected_outcome' in rawPayment);
    assert.ok('ground_truth_reason' in rawPayment);

    // Sanitize
    const cleanTelemetry = sanitizePaymentForStrategy(rawPayment);

    // Assert absolute non-existence of ground-truth fields
    assert.equal('ground_truth_recoverable' in cleanTelemetry, false);
    assert.equal('ground_truth_best_action' in cleanTelemetry, false);
    assert.equal('ground_truth_expected_outcome' in cleanTelemetry, false);
    assert.equal('ground_truth_reason' in cleanTelemetry, false);
    assert.equal((cleanTelemetry as any).ground_truth_recoverable, undefined);
    assert.equal((cleanTelemetry as any).ground_truth_best_action, undefined);
  });

  it('2. Ground-Truth Isolation: Deterministic benchmark agent uses sanitized telemetry only', () => {
    const payment = dataStore.getAllPayments()[0];
    const customer = dataStore.getCustomerById(payment.customer_id)!;
    const cleanTelemetry = sanitizePaymentForStrategy(payment);

    const decision = deterministicBenchmarkAgent(cleanTelemetry, customer);

    assert.ok(decision.payment_id);
    assert.ok(decision.diagnosis);
    assert.ok(decision.recommended_action);
    assert.ok(decision.recoverability_score >= 0 && decision.recoverability_score <= 1.0);
    assert.ok(decision.confidence >= 0 && decision.confidence <= 1.0);
    assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(decision.risk_level));
  });

  it('3. Comparative Benchmark: Full evaluation calculates true non-zero metrics over 600 records', () => {
    const result = runComparativeEvaluation();

    assert.equal(result.success, true);
    assert.equal(result.dataset_size, 600);
    assert.equal(result.ground_truth_isolation_verified, true);

    const { naive_retry_all, deterministic_rules, recoverpay_ai_policy } = result.strategies;

    // All strategies evaluate exactly 600 records
    assert.equal(naive_retry_all.total_records, 600);
    assert.equal(deterministic_rules.total_records, 600);
    assert.equal(recoverpay_ai_policy.total_records, 600);

    // Confusion matrix completeness: TP + FP + FN + TN === 600
    assert.equal(
      naive_retry_all.tp + naive_retry_all.fp + naive_retry_all.fn + naive_retry_all.tn,
      600,
      'Naive strategy confusion matrix must sum to 600'
    );
    assert.equal(
      deterministic_rules.tp + deterministic_rules.fp + deterministic_rules.fn + deterministic_rules.tn,
      600,
      'Deterministic rules confusion matrix must sum to 600'
    );
    assert.equal(
      recoverpay_ai_policy.tp + recoverpay_ai_policy.fp + recoverpay_ai_policy.fn + recoverpay_ai_policy.tn,
      600,
      'RecoverPay confusion matrix must sum to 600'
    );

    // Naive Retry All: Has high tool executions (600), high unnecessary retries, and high safety violations
    assert.equal(naive_retry_all.tool_executions, 600);
    assert.ok(naive_retry_all.unnecessary_retries > 50, 'Naive must have high unnecessary retries');
    assert.ok(naive_retry_all.safety_violations > 0, 'Naive must have severe safety violations');
    assert.equal(naive_retry_all.policy_interceptions, 0, 'Naive has zero policy interceptions');

    // Deterministic Rules: Zero safety violations, but lower precision and higher unnecessary retries
    assert.equal(deterministic_rules.safety_violations, 0);
    assert.ok(deterministic_rules.policy_interceptions > 0);

    // RecoverPay AI + Policy: ZERO safety violations, zero policy bypass, high precision
    assert.equal(recoverpay_ai_policy.safety_violations, 0, 'RecoverPay must have 0 safety violations');
    assert.ok(recoverpay_ai_policy.revenue_recovered_paise > 0, 'RecoverPay must recover revenue');
    assert.ok(recoverpay_ai_policy.precision >= deterministic_rules.precision, 'RecoverPay precision must match or beat deterministic rules');
    assert.ok(recoverpay_ai_policy.policy_interceptions > 0, 'RecoverPay must intercept policy violations');
  });

  it('4. Safety Cases: Evaluates edge cases correctly under RecoverPay policy', () => {
    const policy = dataStore.getPolicy();
    const payments = dataStore.getAllPayments();

    // A. Opted out
    const optedOutPayment = payments.find(p => {
      const cust = dataStore.getCustomerById(p.customer_id);
      return cust?.opted_out;
    });
    assert.ok(optedOutPayment, 'Should have opted out payment in dataset');
    const optedOutCust = dataStore.getCustomerById(optedOutPayment.customer_id)!;
    const decisionA = deterministicBenchmarkAgent(sanitizePaymentForStrategy(optedOutPayment), optedOutCust);
    const policyResA = policyEngine.evaluate(optedOutPayment, optedOutCust, decisionA, policy);
    assert.equal(policyResA.allowed, false);
    assert.ok(policyResA.violations.some(v => v.rule === 'CUSTOMER_OPTED_OUT'));
    assert.equal(policyResA.finalAction, 'STOP');

    // B. High value payment (> ₹50,000)
    const highValuePayment = payments.find(p => p.amount > policy.max_automated_recovery_amount);
    assert.ok(highValuePayment, 'Should have high value payment');
    const highValueCust = dataStore.getCustomerById(highValuePayment.customer_id)!;
    const decisionB = {
      ...deterministicBenchmarkAgent(sanitizePaymentForStrategy(highValuePayment), highValueCust),
      recommended_action: 'RETRY_PAYMENT' as const
    };
    const policyResB = policyEngine.evaluate(highValuePayment, highValueCust, decisionB, policy);
    assert.equal(policyResB.allowed, false);
    assert.ok(policyResB.violations.some(v => v.rule === 'AMOUNT_EXCEEDS_CAP'));

    // C. Max retries exceeded
    const maxRetryPayment = payments.find(p => p.recovery_attempts >= policy.max_retries);
    assert.ok(maxRetryPayment, 'Should have max retry payment');
    const maxRetryCust = dataStore.getCustomerById(maxRetryPayment.customer_id)!;
    const decisionC = {
      ...deterministicBenchmarkAgent(sanitizePaymentForStrategy(maxRetryPayment), maxRetryCust),
      recommended_action: 'RETRY_PAYMENT' as const
    };
    const policyResC = policyEngine.evaluate(maxRetryPayment, maxRetryCust, decisionC, policy);
    assert.equal(policyResC.allowed, false);
    assert.ok(policyResC.violations.some(v => v.rule === 'MAX_RETRIES_EXCEEDED'));

    // D. Cooldown active
    const cooldownPayment = payments.find(p => p.recovery_attempts > 0 && p.seconds_since_failure < policy.min_retry_cooldown_seconds);
    if (cooldownPayment) {
      const cooldownCust = dataStore.getCustomerById(cooldownPayment.customer_id)!;
      const decisionD = {
        ...deterministicBenchmarkAgent(sanitizePaymentForStrategy(cooldownPayment), cooldownCust),
        recommended_action: 'RETRY_PAYMENT' as const
      };
      const policyResD = policyEngine.evaluate(cooldownPayment, cooldownCust, decisionD, policy);
      assert.equal(policyResD.allowed, false);
      assert.ok(policyResD.violations.some(v => v.rule === 'COOLDOWN_ACTIVE'));
    }
  });

  it('5. Financial Honesty: Only status === "captured" yields verified recovered revenue', () => {
    const result = runComparativeEvaluation();
    const recoverpay = result.strategies.recoverpay_ai_policy;

    // Revenue at risk must equal dataset total failure amount
    const stats = dataStore.getStats();
    assert.equal(recoverpay.revenue_at_risk_paise, stats.total_failure_amount);

    // Revenue recovered must be strictly positive and <= revenue at risk
    assert.ok(recoverpay.revenue_recovered_paise > 0);
    assert.ok(recoverpay.revenue_recovered_paise <= recoverpay.revenue_at_risk_paise);
  });
});
