/**
 * RecoverPay Phase 3 Test Suite: Agent Decision Validation, Fallback & Security Isolation
 * Tests runtime schema validation, fallback mechanisms, payment ID integrity,
 * prompt leakage defenses, and zero-state-mutation invariants.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAgentDecision,
  createFallbackDecision
} from '../server/agents/validation.ts';
import {
  RECOVERY_AGENT_SYSTEM_INSTRUCTION,
  buildAgentUserPrompt
} from '../server/agents/promptTemplates.ts';
import {
  GeminiRecoveryAgent,
  geminiRecoveryAgent,
  resolveGeminiModel,
  SUPPORTED_GEMINI_MODEL
} from '../server/agents/geminiRecoveryAgent.ts';
import { policyEngine } from '../server/policies/policyEngine.ts';
import { dataStore } from '../server/db/store.ts';
import { toAgentInputContext } from '../server/data/generator.ts';
import {
  AgentInputContext,
  AIAgentDecision,
  Payment,
  Customer,
  PolicyRules
} from '../src/types/index.ts';

const EXPECTED_PAYMENT_ID = 'pay_rec_0001';

const VALID_RAW_RETRY = {
  payment_id: EXPECTED_PAYMENT_ID,
  diagnosis: 'transient_bank_downtime',
  recoverability_score: 0.88,
  recommended_action: 'RETRY_PAYMENT',
  confidence: 0.92,
  risk_level: 'LOW',
  reasoning: 'Transient issuer switch error. Cooldown satisfied and attempts within limit.'
};

const VALID_RAW_REMINDER = {
  payment_id: EXPECTED_PAYMENT_ID,
  diagnosis: 'insufficient_funds',
  recoverability_score: 0.65,
  recommended_action: 'SEND_PAYMENT_REMINDER',
  confidence: 0.85,
  risk_level: 'MEDIUM',
  reasoning: 'Customer account balance low; sending checkout link for alternative method.',
  customer_recovery_message: 'Your recent payment was declined. Please click here to update your payment method.'
};

const VALID_RAW_ESCALATE = {
  payment_id: EXPECTED_PAYMENT_ID,
  diagnosis: 'authentication_failure',
  recoverability_score: 0.40,
  recommended_action: 'ESCALATE',
  confidence: 0.70,
  risk_level: 'HIGH',
  reasoning: 'Repeated 3DS OTP failures on high-value transaction. Route to operations.'
};

const VALID_RAW_STOP = {
  payment_id: EXPECTED_PAYMENT_ID,
  diagnosis: 'fatal_declined_card',
  recoverability_score: 0.05,
  recommended_action: 'STOP',
  confidence: 0.98,
  risk_level: 'CRITICAL',
  reasoning: 'Card reported stolen/blocked. Cease all recovery attempts.'
};

describe('Phase 3: Agent Decision Schema Validation - Valid Payloads', () => {
  test('1. Valid RETRY_PAYMENT passes schema validation', () => {
    const result = validateAgentDecision(VALID_RAW_RETRY, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, true);
    assert.ok(result.decision);
    assert.equal(result.decision.payment_id, EXPECTED_PAYMENT_ID);
    assert.equal(result.decision.recommended_action, 'RETRY_PAYMENT');
    assert.equal(result.decision.customer_recovery_message, undefined);
  });

  test('2. Valid SEND_PAYMENT_REMINDER with customer message passes schema validation', () => {
    const result = validateAgentDecision(VALID_RAW_REMINDER, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, true);
    assert.ok(result.decision);
    assert.equal(result.decision.recommended_action, 'SEND_PAYMENT_REMINDER');
    assert.equal(
      result.decision.customer_recovery_message,
      'Your recent payment was declined. Please click here to update your payment method.'
    );
  });

  test('3. Valid ESCALATE passes schema validation', () => {
    const result = validateAgentDecision(VALID_RAW_ESCALATE, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, true);
    assert.ok(result.decision);
    assert.equal(result.decision.recommended_action, 'ESCALATE');
  });

  test('4. Valid STOP passes schema validation', () => {
    const result = validateAgentDecision(VALID_RAW_STOP, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, true);
    assert.ok(result.decision);
    assert.equal(result.decision.recommended_action, 'STOP');
  });
});

describe('Phase 3: Agent Decision Schema Validation - Invalid Payloads & Boundary Rejections', () => {
  test('5. Missing payment_id is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, payment_id: undefined };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Missing or empty payment_id'));
  });

  test('6. Payment ID mismatch (integrity check) is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, payment_id: 'pay_rec_0999' };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Payment ID mismatch'));
  });

  test('7. Invalid action verbs (e.g. RETRY, CHARGE_CARD) are strictly rejected', () => {
    const raw1 = { ...VALID_RAW_RETRY, recommended_action: 'RETRY' };
    const result1 = validateAgentDecision(raw1, EXPECTED_PAYMENT_ID);
    assert.equal(result1.valid, false);
    assert.ok(result1.error?.includes('Invalid action'));

    const raw2 = { ...VALID_RAW_RETRY, recommended_action: 'CHARGE_CARD' };
    const result2 = validateAgentDecision(raw2, EXPECTED_PAYMENT_ID);
    assert.equal(result2.valid, false);
  });

  test('8. Invalid diagnosis enum is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, diagnosis: 'unknown_bank_issue' };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Invalid diagnosis'));
  });

  test('9. Invalid risk_level enum is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, risk_level: 'EXTREME' };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Invalid risk_level'));
  });

  test('10. Confidence < 0.00 is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, confidence: -0.05 };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('confidence out of bounds'));
  });

  test('11. Confidence > 1.00 is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, confidence: 1.05 };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('confidence out of bounds'));
  });

  test('12. Recoverability score < 0.00 is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, recoverability_score: -0.01 };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('recoverability_score out of bounds'));
  });

  test('13. Recoverability score > 1.00 is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, recoverability_score: 1.5 };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('recoverability_score out of bounds'));
  });

  test('14. Non-numeric or non-finite values (NaN, Infinity, strings) are rejected', () => {
    const rawNaN = { ...VALID_RAW_RETRY, confidence: NaN };
    assert.equal(validateAgentDecision(rawNaN, EXPECTED_PAYMENT_ID).valid, false);

    const rawInf = { ...VALID_RAW_RETRY, confidence: Infinity };
    assert.equal(validateAgentDecision(rawInf, EXPECTED_PAYMENT_ID).valid, false);

    const rawStr = { ...VALID_RAW_RETRY, confidence: '0.90' as any };
    assert.equal(validateAgentDecision(rawStr, EXPECTED_PAYMENT_ID).valid, false);
  });

  test('15. Missing required reasoning is rejected', () => {
    const raw = { ...VALID_RAW_RETRY, reasoning: '   ' };
    const result = validateAgentDecision(raw, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Missing or empty reasoning'));
  });

  test('16. Null or primitive response is rejected', () => {
    assert.equal(validateAgentDecision(null, EXPECTED_PAYMENT_ID).valid, false);
    assert.equal(validateAgentDecision(undefined, EXPECTED_PAYMENT_ID).valid, false);
    assert.equal(validateAgentDecision('some string', EXPECTED_PAYMENT_ID).valid, false);
    assert.equal(validateAgentDecision([], EXPECTED_PAYMENT_ID).valid, false);
  });
});

describe('Phase 3: Fallback Mechanism & Consistency Guarantees', () => {
  test('17. Fallback decision factory creates bounded ESCALATE decision', () => {
    const fallback = createFallbackDecision(EXPECTED_PAYMENT_ID, 'API timeout error');
    assert.equal(fallback.payment_id, EXPECTED_PAYMENT_ID);
    assert.equal(fallback.recommended_action, 'ESCALATE');
    assert.equal(fallback.confidence, 0);
    assert.equal(fallback.recoverability_score, 0);
    assert.equal(fallback.risk_level, 'HIGH');
    assert.ok(fallback.reasoning.includes('API timeout error'));
  });

  test('18. Missing or placeholder GEMINI_API_KEY gracefully returns structured fallback', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      // Simulate unconfigured API key
      process.env.GEMINI_API_KEY = '';

      const agent = new GeminiRecoveryAgent();
      const mockContext: AgentInputContext = {
        payment: {
          id: EXPECTED_PAYMENT_ID,
          amount: 250000,
          currency: 'INR',
          failure_category: 'TRANSIENT_BANK_FAILURE',
          failure_code: 'BANK_UNAVAILABLE',
          failure_reason: 'Bank server busy',
          attempt_count: 1,
          recovery_attempts: 0,
          seconds_since_failure: 1200,
          last_attempt_at: new Date().toISOString()
        },
        customer: {
          id: 'cust_001',
          historical_success_rate: 0.95,
          previous_success_count: 19,
          previous_failure_count: 1,
          opted_out: false
        },
        merchant_policy_context: {
          max_retries: 2,
          max_automated_amount: 5000000,
          min_cooldown_seconds: 900
        }
      };

      const result = await agent.diagnose(mockContext);
      assert.equal(result.success, false);
      assert.equal(result.fallback, true);
      assert.equal(result.decision.payment_id, EXPECTED_PAYMENT_ID);
      assert.equal(result.decision.recommended_action, 'ESCALATE');
      assert.ok(result.error?.includes('GEMINI_API_KEY_MISSING'));
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  test('19. Non-REMINDER actions strip customer_recovery_message', () => {
    const rawWithAccidentalMessage = {
      ...VALID_RAW_RETRY,
      customer_recovery_message: 'You must pay now'
    };

    const result = validateAgentDecision(rawWithAccidentalMessage, EXPECTED_PAYMENT_ID);
    assert.equal(result.valid, true);
    assert.equal(result.decision?.customer_recovery_message, undefined);
  });
});

describe('Phase 3: Security & Ground Truth Isolation Invariants', () => {
  test('20. toAgentInputContext strips all ground-truth fields from raw payment', () => {
    const fullPayment = dataStore.getAllPayments()[0];
    const fullCustomer = dataStore.getCustomerById(fullPayment.customer_id)!;
    const policy = dataStore.getPolicy();

    // Verify raw payment actually has ground truth fields
    assert.notEqual((fullPayment as any).ground_truth_recoverable, undefined);
    assert.notEqual((fullPayment as any).ground_truth_best_action, undefined);
    assert.notEqual((fullPayment as any).ground_truth_expected_outcome, undefined);
    assert.notEqual((fullPayment as any).ground_truth_reason, undefined);

    const context = toAgentInputContext(fullPayment, fullCustomer, policy);
    const contextAny = context as any;

    // Verify agent context has NO ground truth fields whatsoever
    assert.equal(contextAny.payment.ground_truth_recoverable, undefined);
    assert.equal(contextAny.payment.ground_truth_best_action, undefined);
    assert.equal(contextAny.payment.ground_truth_expected_outcome, undefined);
    assert.equal(contextAny.payment.ground_truth_reason, undefined);
    assert.equal(contextAny.ground_truth_recoverable, undefined);
  });

  test('21. buildAgentUserPrompt does not contain ground_truth substrings or oracle labels', () => {
    const fullPayment = dataStore.getAllPayments()[0];
    const fullCustomer = dataStore.getCustomerById(fullPayment.customer_id)!;
    const policy = dataStore.getPolicy();

    const context = toAgentInputContext(fullPayment, fullCustomer, policy);
    const prompt = buildAgentUserPrompt(context);

    // Verify no ground truth key identifiers appear anywhere in prompt
    assert.ok(!prompt.includes('ground_truth'));
    assert.ok(!prompt.includes('ground_truth_recoverable'));
    assert.ok(!prompt.includes('ground_truth_best_action'));
    assert.ok(!prompt.includes('ground_truth_expected_outcome'));
    assert.ok(!prompt.includes('ground_truth_reason'));

    // Verify for an edge record where ground truth reason is an oracle override
    const optedOutPayment = dataStore.getAllPayments().find(p => p.ground_truth_reason.includes('opted out'))!;
    const optedOutCustomer = dataStore.getCustomerById(optedOutPayment.customer_id)!;
    const edgeContext = toAgentInputContext(optedOutPayment, optedOutCustomer, policy);
    const edgePrompt = buildAgentUserPrompt(edgeContext);
    assert.ok(!edgePrompt.includes(optedOutPayment.ground_truth_reason));
  });

  test('22. System prompt explicitly forbids autonomous action execution', () => {
    assert.ok(RECOVERY_AGENT_SYSTEM_INSTRUCTION.includes('DIAGNOSTIC ASSISTANT, NOT an autonomous payment executor'));
    assert.ok(RECOVERY_AGENT_SYSTEM_INSTRUCTION.includes('strictly evaluated by an external deterministic policy engine'));
    assert.ok(RECOVERY_AGENT_SYSTEM_INSTRUCTION.includes('Never claim an action was executed'));
  });

  test('23. Agent service cannot execute tools or mutate payment state', () => {
    const agent = new GeminiRecoveryAgent();
    assert.equal(typeof (agent as any).retryPayment, 'undefined');
    assert.equal(typeof (agent as any).callRazorpay, 'undefined');
    assert.equal(typeof (agent as any).executeAction, 'undefined');
  });

  test('24. Diagnosing a payment does not mutate datastore records', async () => {
    const paymentBefore = dataStore.getPaymentById(EXPECTED_PAYMENT_ID);
    assert.ok(paymentBefore);
    const statusBefore = paymentBefore.status;
    const attemptsBefore = paymentBefore.recovery_attempts;

    // Run validation simulation
    const validation = validateAgentDecision(VALID_RAW_RETRY, EXPECTED_PAYMENT_ID);
    assert.equal(validation.valid, true);

    const paymentAfter = dataStore.getPaymentById(EXPECTED_PAYMENT_ID);
    assert.equal(paymentAfter?.status, statusBefore);
    assert.equal(paymentAfter?.recovery_attempts, attemptsBefore);
  });
});

describe('Phase 3: Agent Decision + Policy Engine Integration', () => {
  const BASE_POLICY: PolicyRules = {
    id: 'pol_test_01',
    max_retries: 2,
    max_automated_recovery_amount: 5000000,
    min_retry_cooldown_seconds: 900,
    do_not_retry_after_success: true,
    do_not_retry_if_customer_opted_out: true,
    low_confidence_threshold: 0.60
  };

  const BASE_PAYMENT: Payment = {
    id: EXPECTED_PAYMENT_ID,
    customer_id: 'cust_001',
    order_id: 'order_001',
    amount: 150000,
    currency: 'INR',
    status: 'failed',
    failure_category: 'TRANSIENT_BANK_FAILURE',
    failure_code: 'BANK_UNAVAILABLE',
    failure_reason: 'Switch unavailable',
    attempt_count: 1,
    recovery_attempts: 0,
    seconds_since_failure: 1200,
    last_attempt_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ground_truth_recoverable: true,
    ground_truth_best_action: 'RETRY_PAYMENT',
    ground_truth_expected_outcome: 'RECOVERED',
    ground_truth_reason: 'Transient outage'
  };

  const BASE_CUSTOMER: Customer = {
    id: 'cust_001',
    name: 'Test Customer',
    email: 'test@example.com',
    contact: '+919876543210',
    lifetime_value: 500000,
    previous_success_count: 10,
    previous_failure_count: 0,
    historical_success_rate: 1.0,
    opted_out: false,
    created_at: new Date().toISOString()
  };

  test('25. Valid AI decision (RETRY_PAYMENT, conf 0.92) is ALLOWED by policy engine', () => {
    const decision: AIAgentDecision = {
      payment_id: EXPECTED_PAYMENT_ID,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.88,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.92,
      risk_level: 'LOW',
      reasoning: 'Clean recovery profile'
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'RETRY_PAYMENT');
    assert.equal(result.violations.length, 0);
  });

  test('26. Low confidence AI decision (conf 0.45) with RETRY_PAYMENT is BLOCKED and routed to ESCALATE', () => {
    const decision: AIAgentDecision = {
      payment_id: EXPECTED_PAYMENT_ID,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.50,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.45, // < 0.60
      risk_level: 'MEDIUM',
      reasoning: 'Uncertain bank status'
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, false);
    assert.equal(result.finalAction, 'ESCALATE');
    assert.ok(result.violations.some(v => v.rule === 'LOW_CONFIDENCE'));
  });

  test('27. Low confidence AI decision (conf 0.40) with STOP is ALLOWED to STOP (safe shutdown)', () => {
    const decision: AIAgentDecision = {
      payment_id: EXPECTED_PAYMENT_ID,
      diagnosis: 'fatal_declined_card',
      recoverability_score: 0.10,
      recommended_action: 'STOP',
      confidence: 0.40,
      risk_level: 'HIGH',
      reasoning: 'Possible blocked card'
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'STOP');
  });

  test('28. Low confidence AI decision (conf 0.30) with ESCALATE is ALLOWED to ESCALATE', () => {
    const decision: AIAgentDecision = {
      payment_id: EXPECTED_PAYMENT_ID,
      diagnosis: 'authentication_failure',
      recoverability_score: 0.35,
      recommended_action: 'ESCALATE',
      confidence: 0.30,
      risk_level: 'HIGH',
      reasoning: 'Suspicious authentication failure pattern'
    };

    const result = policyEngine.evaluate(BASE_PAYMENT, BASE_CUSTOMER, decision, BASE_POLICY);
    assert.equal(result.allowed, true);
    assert.equal(result.finalAction, 'ESCALATE');
  });

  test('29. Runtime model resolver returns sensible default gemini-3.8-flash when unset', () => {
    const saved = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    try {
      const model = resolveGeminiModel();
      assert.equal(model, 'gemini-3.8-flash');
      assert.equal(SUPPORTED_GEMINI_MODEL, 'gemini-3.8-flash');
      assert.equal(geminiRecoveryAgent.getModel(), 'gemini-3.8-flash');
    } finally {
      if (saved !== undefined) process.env.GEMINI_MODEL = saved;
    }
  });

  test('30. Runtime model resolver dynamically respects custom GEMINI_MODEL configuration', () => {
    const saved = process.env.GEMINI_MODEL;
    const testModels = [
      'gemini-3.1-pro-preview',
      'gemini-3.8-flash',
      'gemini-flash-latest'
    ];
    try {
      for (const m of testModels) {
        process.env.GEMINI_MODEL = m;
        assert.equal(resolveGeminiModel(), m, `Expected configured model ${m}`);
      }
    } finally {
      if (saved !== undefined) process.env.GEMINI_MODEL = saved;
    }
  });

  test('31. GeminiRecoveryAgent instance reports active configured model or default', () => {
    const saved = process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL;
    try {
      const agent = new GeminiRecoveryAgent();
      assert.equal(agent.getModel(), 'gemini-3.8-flash');
      process.env.GEMINI_MODEL = 'gemini-3.1-pro-preview';
      assert.equal(agent.getModel(), 'gemini-3.1-pro-preview');
    } finally {
      if (saved !== undefined) process.env.GEMINI_MODEL = saved;
    }
  });

  test('32. Missing or dummy API key triggers fail-closed ESCALATE fallback with confidence 0', async () => {
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = '';
    try {
      const agent = new GeminiRecoveryAgent();
      const mockContext: AgentInputContext = {
        payment: {
          id: 'pay_fail_closed_test',
          amount: 10000,
          currency: 'INR',
          failure_category: 'TRANSIENT_BANK_FAILURE',
          failure_code: 'BANK_NETWORK_DOWN',
          failure_reason: 'Switch unavailable',
          attempt_count: 1,
          recovery_attempts: 0,
          seconds_since_failure: 1200,
          last_attempt_at: new Date().toISOString()
        },
        customer: {
          id: 'cust_fail_closed_test',
          historical_success_rate: 0.9,
          previous_success_count: 9,
          previous_failure_count: 1,
          opted_out: false
        },
        merchant_policy_context: {
          max_retries: 2,
          max_automated_amount: 5000000,
          min_cooldown_seconds: 900
        }
      };

      const result = await agent.diagnose(mockContext);
      assert.equal(result.success, false);
      assert.equal(result.fallback, true);
      assert.equal(result.decision?.recommended_action, 'ESCALATE');
      assert.equal(result.decision?.confidence, 0);
      assert.equal(result.decision?.risk_level, 'HIGH');
    } finally {
      process.env.GEMINI_API_KEY = savedKey;
    }
  });
});
