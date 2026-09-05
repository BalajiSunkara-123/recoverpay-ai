/**
 * Deterministic Synthetic Dataset Generator for RecoverPay
 * Uses a deterministic PRNG (Mulberry32) seeded with a fixed seed (1337)
 * to generate exactly 600 realistic payment records with hidden ground truth labels.
 */

import {
  Customer,
  Payment,
  FailureCategory,
  RecoveryAction,
  GroundTruthOutcome,
  DatasetStats,
  AgentInputContext,
  PolicyRules
} from '../../src/types/index.ts';

// Deterministic 32-bit PRNG (Mulberry32)
function createPRNG(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FailureSpec {
  category: FailureCategory;
  codes: { code: string; reason: string; defaultAction: RecoveryAction; recoverable: boolean }[];
}

const FAILURE_SPECS: Record<FailureCategory, FailureSpec> = {
  TRANSIENT_BANK_FAILURE: {
    category: 'TRANSIENT_BANK_FAILURE',
    codes: [
      { code: 'BANK_SYSTEM_BUSY', reason: 'Issuer switch returned 504 server busy timeout', defaultAction: 'RETRY_PAYMENT', recoverable: true },
      { code: 'ISSUER_TIMEOUT', reason: 'Beneficiary bank processing gateway timed out', defaultAction: 'RETRY_PAYMENT', recoverable: true },
      { code: 'SWITCH_DOWN', reason: 'NPCI/Card switch temporarily unavailable', defaultAction: 'RETRY_PAYMENT', recoverable: true }
    ]
  },
  NETWORK_ERROR: {
    category: 'NETWORK_ERROR',
    codes: [
      { code: 'NETWORK_TIMEOUT', reason: 'Payment session dropped due to socket timeout', defaultAction: 'RETRY_PAYMENT', recoverable: true },
      { code: 'SESSION_EXPIRED', reason: 'Checkout session expired while awaiting webhook confirmation', defaultAction: 'RETRY_PAYMENT', recoverable: true },
      { code: 'SOCKET_CLOSED', reason: 'Client closed connection before authorization ACK received', defaultAction: 'RETRY_PAYMENT', recoverable: true }
    ]
  },
  INSUFFICIENT_FUNDS: {
    category: 'INSUFFICIENT_FUNDS',
    codes: [
      { code: 'INSUFFICIENT_FUNDS', reason: 'Customer account balance insufficient for charge', defaultAction: 'SEND_PAYMENT_REMINDER', recoverable: true },
      { code: 'BALANCE_EXCEEDED', reason: 'Daily UPI/card transaction limit exceeded by customer', defaultAction: 'SEND_PAYMENT_REMINDER', recoverable: true },
      { code: 'ACCOUNT_LIMIT_EXCEEDED', reason: 'Bank account debit limit exceeded for payment channel', defaultAction: 'SEND_PAYMENT_REMINDER', recoverable: true }
    ]
  },
  AUTHENTICATION_FAILURE: {
    category: 'AUTHENTICATION_FAILURE',
    codes: [
      { code: 'OTP_EXPIRED', reason: 'One-Time Password window expired before submission', defaultAction: 'SEND_PAYMENT_REMINDER', recoverable: true },
      { code: '3DS_CANCELLED', reason: 'User navigated away from 3D Secure authentication page', defaultAction: 'SEND_PAYMENT_REMINDER', recoverable: true },
      { code: 'AUTH_FAILED', reason: 'Card 3D Secure verification failed due to incorrect PIN', defaultAction: 'SEND_PAYMENT_REMINDER', recoverable: true }
    ]
  },
  EXPIRED_CARD: {
    category: 'EXPIRED_CARD',
    codes: [
      { code: 'CARD_EXPIRED', reason: 'Card validity date passed expiry month/year', defaultAction: 'STOP', recoverable: false },
      { code: 'INVALID_EXPIRY_DATE', reason: 'Card expiration details rejected by issuer', defaultAction: 'STOP', recoverable: false }
    ]
  },
  FATAL_DECLINE: {
    category: 'FATAL_DECLINE',
    codes: [
      { code: 'STOLEN_CARD', reason: 'Card flagged as lost or stolen by issuing bank', defaultAction: 'STOP', recoverable: false },
      { code: 'DO_NOT_HONOR', reason: 'Issuer declined charge with zero retry clearance', defaultAction: 'STOP', recoverable: false },
      { code: 'ACCOUNT_CLOSED', reason: 'Bank account or credit facility permanently closed', defaultAction: 'STOP', recoverable: false }
    ]
  }
};

const CATEGORY_DISTRIBUTION: { category: FailureCategory; count: number }[] = [
  { category: 'TRANSIENT_BANK_FAILURE', count: 192 }, // 32%
  { category: 'NETWORK_ERROR', count: 108 },          // 18%
  { category: 'INSUFFICIENT_FUNDS', count: 144 },     // 24%
  { category: 'AUTHENTICATION_FAILURE', count: 84 },  // 14%
  { category: 'EXPIRED_CARD', count: 48 },            // 8%
  { category: 'FATAL_DECLINE', count: 24 }            // 4%
];

export interface GeneratedDataset {
  customers: Customer[];
  payments: Payment[];
  stats: DatasetStats;
}

export function generateSyntheticDataset(seed = 1337): GeneratedDataset {
  const prng = createPRNG(seed);

  // We need exactly 600 records with:
  // - 25 opted-out customers
  // - 35 high-value (> ₹50,000 = > 5000000 paise)
  // - 30 transactions already at maximum recovery attempts (recovery_attempts = 2)
  // - 20 transactions inside cooldown period (seconds_since_failure < 900)

  // Designated indices across the 600 records for the edge cases
  const optedOutIndices = new Set<number>();
  while (optedOutIndices.size < 25) {
    optedOutIndices.add(Math.floor(prng() * 600));
  }

  const highValueIndices = new Set<number>();
  while (highValueIndices.size < 35) {
    const idx = Math.floor(prng() * 600);
    highValueIndices.add(idx);
  }

  const maxRetryIndices = new Set<number>();
  while (maxRetryIndices.size < 30) {
    const idx = Math.floor(prng() * 600);
    maxRetryIndices.add(idx);
  }

  const cooldownActiveIndices = new Set<number>();
  while (cooldownActiveIndices.size < 20) {
    const idx = Math.floor(prng() * 600);
    cooldownActiveIndices.add(idx);
  }

  // Create list of categories matching exact distribution
  const categoriesList: FailureCategory[] = [];
  for (const item of CATEGORY_DISTRIBUTION) {
    for (let i = 0; i < item.count; i++) {
      categoriesList.push(item.category);
    }
  }

  // Fisher-Yates shuffle with PRNG to randomize category order across the 600 slots
  for (let i = categoriesList.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = categoriesList[i];
    categoriesList[i] = categoriesList[j];
    categoriesList[j] = tmp;
  }

  const customers: Customer[] = [];
  const payments: Payment[] = [];
  const customerMap = new Map<string, Customer>();

  // Base timestamp (anchored in recent time)
  const baseTime = new Date('2026-09-04T20:00:00.000Z').getTime();

  for (let i = 0; i < 600; i++) {
    const paymentSeq = (i + 1).toString().padStart(4, '0');
    const paymentId = `pay_rec_${paymentSeq}`;
    const customerId = `cust_rec_${paymentSeq}`;
    const orderId = `order_rec_${paymentSeq}`;

    const category = categoriesList[i];
    const spec = FAILURE_SPECS[category];
    const codeObj = spec.codes[Math.floor(prng() * spec.codes.length)];

    // Check edge case memberships
    const isOptedOut = optedOutIndices.has(i);
    const isHighValue = highValueIndices.has(i);
    const isMaxRetry = maxRetryIndices.has(i);
    const isCooldownActive = cooldownActiveIndices.has(i);

    // Amount generation (in paise)
    let amount: number;
    if (isHighValue) {
      // > ₹50,000: from ₹51,000 to ₹150,000
      amount = Math.floor(51000 + prng() * 99000) * 100;
    } else {
      // Normal transaction range: ₹299 to ₹14,999
      const baseRupees = [299, 499, 999, 1499, 2499, 4999, 7999, 11999, 14999];
      const selected = baseRupees[Math.floor(prng() * baseRupees.length)];
      amount = selected * 100;
    }

    // Customer history metrics
    const prevSuccess = Math.floor(2 + prng() * 20);
    const prevFail = Math.floor(prng() * 4);
    const totalPrev = prevSuccess + prevFail;
    const successRate = totalPrev > 0 ? Number((prevSuccess / totalPrev).toFixed(2)) : 0.85;
    const ltv = (prevSuccess * amount) + Math.floor(prng() * 500000);

    const customer: Customer = {
      id: customerId,
      name: `Merchant Client ${paymentSeq}`,
      email: `client.${paymentSeq}@razorpay-partner.internal`,
      contact: `+9198${(10000000 + i).toString().slice(0, 8)}`,
      lifetime_value: ltv,
      previous_success_count: prevSuccess,
      previous_failure_count: prevFail,
      historical_success_rate: successRate,
      opted_out: isOptedOut,
      created_at: new Date(baseTime - (86400000 * 30)).toISOString()
    };
    customers.push(customer);
    customerMap.set(customerId, customer);

    // Time since failure & cooldown calculation
    // Cooldown window requirement: < 900 seconds (15 min) for active cooldown, else >= 900 seconds (up to 4 hours)
    let secondsSinceFailure: number;
    if (isCooldownActive) {
      secondsSinceFailure = Math.floor(120 + prng() * 720); // 2 min to 14 min (< 900s)
    } else {
      secondsSinceFailure = Math.floor(950 + prng() * 14000); // 16 min to 4.2 hours
    }

    const failureTime = new Date(baseTime - (secondsSinceFailure * 1000));
    const recoveryAttempts = isMaxRetry ? 2 : (prng() > 0.7 ? 1 : 0);
    const attemptCount = recoveryAttempts + 1;

    // Ground truth calculation (Evaluation oracle)
    let gtRecoverable = codeObj.recoverable;
    let gtBestAction: RecoveryAction = codeObj.defaultAction;
    let gtExpectedOutcome: GroundTruthOutcome = codeObj.recoverable ? 'RECOVERED' : 'PERMANENTLY_FAILED';
    let gtReason = codeObj.reason;

    // Ground-truth overrides based on hard banking logic
    if (isOptedOut) {
      gtRecoverable = false;
      gtBestAction = 'STOP';
      gtExpectedOutcome = 'PERMANENTLY_FAILED';
      gtReason = 'Customer explicitly opted out of automated recovery outreach.';
    } else if (category === 'EXPIRED_CARD') {
      gtRecoverable = false;
      gtBestAction = 'STOP';
      gtExpectedOutcome = 'PERMANENTLY_FAILED';
      gtReason = 'Card expired. Automated retry on expired token causes bank charge failure.';
    } else if (category === 'FATAL_DECLINE') {
      gtRecoverable = false;
      gtBestAction = 'STOP';
      gtExpectedOutcome = 'PERMANENTLY_FAILED';
      gtReason = 'Card permanently cancelled, stolen, or flagged with fatal bank refusal.';
    } else if (isMaxRetry) {
      gtRecoverable = false;
      gtBestAction = 'ESCALATE';
      gtExpectedOutcome = 'PERMANENTLY_FAILED';
      gtReason = 'Maximum retries exhausted (2/2). Must not trigger automated retry; requires manual ops escalation.';
    } else if (isHighValue) {
      // High value transactions require human confirmation/escalation per banking policy
      gtBestAction = 'ESCALATE';
      gtReason = 'High value transaction exceeding ₹50,000 threshold requires manual clearance.';
    }

    const payment: Payment = {
      id: paymentId,
      customer_id: customerId,
      order_id: orderId,
      amount,
      currency: 'INR',
      status: 'failed',
      failure_category: category,
      failure_code: codeObj.code,
      failure_reason: codeObj.reason,
      attempt_count: attemptCount,
      recovery_attempts: recoveryAttempts,
      seconds_since_failure: secondsSinceFailure,
      last_attempt_at: failureTime.toISOString(),
      created_at: new Date(failureTime.getTime() - 60000).toISOString(),
      updated_at: failureTime.toISOString(),

      // HIDDEN GROUND TRUTH (Evaluation oracle ONLY)
      ground_truth_recoverable: gtRecoverable,
      ground_truth_best_action: gtBestAction,
      ground_truth_expected_outcome: gtExpectedOutcome,
      ground_truth_reason: gtReason
    };

    payments.push(payment);
  }

  // Calculate statistics
  const categoryDist: Record<FailureCategory, number> = {
    TRANSIENT_BANK_FAILURE: 0,
    NETWORK_ERROR: 0,
    INSUFFICIENT_FUNDS: 0,
    AUTHENTICATION_FAILURE: 0,
    EXPIRED_CARD: 0,
    FATAL_DECLINE: 0
  };

  let totalAmount = 0;
  let recoverableCount = 0;
  let recoverableAmount = 0;

  for (const p of payments) {
    categoryDist[p.failure_category]++;
    totalAmount += p.amount;
    if (p.ground_truth_recoverable) {
      recoverableCount++;
      recoverableAmount += p.amount;
    }
  }

  const stats: DatasetStats = {
    total_records: payments.length,
    category_distribution: categoryDist,
    edge_cases: {
      opted_out_count: optedOutIndices.size,
      high_value_count: highValueIndices.size,
      max_retries_count: maxRetryIndices.size,
      cooldown_active_count: cooldownActiveIndices.size
    },
    total_failure_amount: totalAmount,
    ground_truth_recoverable_count: recoverableCount,
    ground_truth_recoverable_amount: recoverableAmount,
    generated_at: new Date().toISOString()
  };

  return { customers, payments, stats };
}

/**
 * CONTEXT SANITIZER / ISOLATION FUNCTION
 * Strips all hidden ground-truth fields and returns strictly sanitized context for Gemini.
 */
export function toAgentInputContext(
  payment: Payment,
  customer: Customer,
  policy: PolicyRules
): AgentInputContext {
  return {
    payment: {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      failure_category: payment.failure_category,
      failure_code: payment.failure_code,
      failure_reason: payment.failure_reason,
      attempt_count: payment.attempt_count,
      recovery_attempts: payment.recovery_attempts,
      seconds_since_failure: payment.seconds_since_failure,
      last_attempt_at: payment.last_attempt_at
    },
    customer: {
      id: customer.id,
      historical_success_rate: customer.historical_success_rate,
      previous_success_count: customer.previous_success_count,
      previous_failure_count: customer.previous_failure_count,
      opted_out: customer.opted_out
    },
    merchant_policy_context: {
      max_retries: policy.max_retries,
      max_automated_amount: policy.max_automated_recovery_amount,
      min_cooldown_seconds: policy.min_retry_cooldown_seconds
    }
  };
}
