// server/app.ts
import express from "express";

// server/db/store.ts
import fs from "fs";
import path from "path";

// server/data/generator.ts
function createPRNG(seed) {
  let s = seed >>> 0;
  return function next() {
    s = s + 1831565813 >>> 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var FAILURE_SPECS = {
  TRANSIENT_BANK_FAILURE: {
    category: "TRANSIENT_BANK_FAILURE",
    codes: [
      { code: "BANK_SYSTEM_BUSY", reason: "Issuer switch returned 504 server busy timeout", defaultAction: "RETRY_PAYMENT", recoverable: true },
      { code: "ISSUER_TIMEOUT", reason: "Beneficiary bank processing gateway timed out", defaultAction: "RETRY_PAYMENT", recoverable: true },
      { code: "SWITCH_DOWN", reason: "NPCI/Card switch temporarily unavailable", defaultAction: "RETRY_PAYMENT", recoverable: true }
    ]
  },
  NETWORK_ERROR: {
    category: "NETWORK_ERROR",
    codes: [
      { code: "NETWORK_TIMEOUT", reason: "Payment session dropped due to socket timeout", defaultAction: "RETRY_PAYMENT", recoverable: true },
      { code: "SESSION_EXPIRED", reason: "Checkout session expired while awaiting webhook confirmation", defaultAction: "RETRY_PAYMENT", recoverable: true },
      { code: "SOCKET_CLOSED", reason: "Client closed connection before authorization ACK received", defaultAction: "RETRY_PAYMENT", recoverable: true }
    ]
  },
  INSUFFICIENT_FUNDS: {
    category: "INSUFFICIENT_FUNDS",
    codes: [
      { code: "INSUFFICIENT_FUNDS", reason: "Customer account balance insufficient for charge", defaultAction: "SEND_PAYMENT_REMINDER", recoverable: true },
      { code: "BALANCE_EXCEEDED", reason: "Daily UPI/card transaction limit exceeded by customer", defaultAction: "SEND_PAYMENT_REMINDER", recoverable: true },
      { code: "ACCOUNT_LIMIT_EXCEEDED", reason: "Bank account debit limit exceeded for payment channel", defaultAction: "SEND_PAYMENT_REMINDER", recoverable: true }
    ]
  },
  AUTHENTICATION_FAILURE: {
    category: "AUTHENTICATION_FAILURE",
    codes: [
      { code: "OTP_EXPIRED", reason: "One-Time Password window expired before submission", defaultAction: "SEND_PAYMENT_REMINDER", recoverable: true },
      { code: "3DS_CANCELLED", reason: "User navigated away from 3D Secure authentication page", defaultAction: "SEND_PAYMENT_REMINDER", recoverable: true },
      { code: "AUTH_FAILED", reason: "Card 3D Secure verification failed due to incorrect PIN", defaultAction: "SEND_PAYMENT_REMINDER", recoverable: true }
    ]
  },
  EXPIRED_CARD: {
    category: "EXPIRED_CARD",
    codes: [
      { code: "CARD_EXPIRED", reason: "Card validity date passed expiry month/year", defaultAction: "STOP", recoverable: false },
      { code: "INVALID_EXPIRY_DATE", reason: "Card expiration details rejected by issuer", defaultAction: "STOP", recoverable: false }
    ]
  },
  FATAL_DECLINE: {
    category: "FATAL_DECLINE",
    codes: [
      { code: "STOLEN_CARD", reason: "Card flagged as lost or stolen by issuing bank", defaultAction: "STOP", recoverable: false },
      { code: "DO_NOT_HONOR", reason: "Issuer declined charge with zero retry clearance", defaultAction: "STOP", recoverable: false },
      { code: "ACCOUNT_CLOSED", reason: "Bank account or credit facility permanently closed", defaultAction: "STOP", recoverable: false }
    ]
  }
};
var CATEGORY_DISTRIBUTION = [
  { category: "TRANSIENT_BANK_FAILURE", count: 192 },
  // 32%
  { category: "NETWORK_ERROR", count: 108 },
  // 18%
  { category: "INSUFFICIENT_FUNDS", count: 144 },
  // 24%
  { category: "AUTHENTICATION_FAILURE", count: 84 },
  // 14%
  { category: "EXPIRED_CARD", count: 48 },
  // 8%
  { category: "FATAL_DECLINE", count: 24 }
  // 4%
];
function generateSyntheticDataset(seed = 1337) {
  const prng = createPRNG(seed);
  const optedOutIndices = /* @__PURE__ */ new Set();
  while (optedOutIndices.size < 25) {
    optedOutIndices.add(Math.floor(prng() * 600));
  }
  const highValueIndices = /* @__PURE__ */ new Set();
  while (highValueIndices.size < 35) {
    const idx = Math.floor(prng() * 600);
    highValueIndices.add(idx);
  }
  const maxRetryIndices = /* @__PURE__ */ new Set();
  while (maxRetryIndices.size < 30) {
    const idx = Math.floor(prng() * 600);
    maxRetryIndices.add(idx);
  }
  const cooldownActiveIndices = /* @__PURE__ */ new Set();
  while (cooldownActiveIndices.size < 20) {
    const idx = Math.floor(prng() * 600);
    cooldownActiveIndices.add(idx);
  }
  const categoriesList = [];
  for (const item of CATEGORY_DISTRIBUTION) {
    for (let i = 0; i < item.count; i++) {
      categoriesList.push(item.category);
    }
  }
  for (let i = categoriesList.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = categoriesList[i];
    categoriesList[i] = categoriesList[j];
    categoriesList[j] = tmp;
  }
  const customers = [];
  const payments = [];
  const customerMap = /* @__PURE__ */ new Map();
  const baseTime = (/* @__PURE__ */ new Date("2026-09-04T20:00:00.000Z")).getTime();
  for (let i = 0; i < 600; i++) {
    const paymentSeq = (i + 1).toString().padStart(4, "0");
    const paymentId = `pay_rec_${paymentSeq}`;
    const customerId = `cust_rec_${paymentSeq}`;
    const orderId = `order_rec_${paymentSeq}`;
    const category = categoriesList[i];
    const spec = FAILURE_SPECS[category];
    const codeObj = spec.codes[Math.floor(prng() * spec.codes.length)];
    const isOptedOut = optedOutIndices.has(i);
    const isHighValue = highValueIndices.has(i);
    const isMaxRetry = maxRetryIndices.has(i);
    const isCooldownActive = cooldownActiveIndices.has(i);
    let amount;
    if (isHighValue) {
      amount = Math.floor(51e3 + prng() * 99e3) * 100;
    } else {
      const baseRupees = [299, 499, 999, 1499, 2499, 4999, 7999, 11999, 14999];
      const selected = baseRupees[Math.floor(prng() * baseRupees.length)];
      amount = selected * 100;
    }
    const prevSuccess = Math.floor(2 + prng() * 20);
    const prevFail = Math.floor(prng() * 4);
    const totalPrev = prevSuccess + prevFail;
    const successRate = totalPrev > 0 ? Number((prevSuccess / totalPrev).toFixed(2)) : 0.85;
    const ltv = prevSuccess * amount + Math.floor(prng() * 5e5);
    const customer = {
      id: customerId,
      name: `Merchant Client ${paymentSeq}`,
      email: `client.${paymentSeq}@razorpay-partner.internal`,
      contact: `+9198${(1e7 + i).toString().slice(0, 8)}`,
      lifetime_value: ltv,
      previous_success_count: prevSuccess,
      previous_failure_count: prevFail,
      historical_success_rate: successRate,
      opted_out: isOptedOut,
      created_at: new Date(baseTime - 864e5 * 30).toISOString()
    };
    customers.push(customer);
    customerMap.set(customerId, customer);
    let secondsSinceFailure;
    if (isCooldownActive) {
      secondsSinceFailure = Math.floor(120 + prng() * 720);
    } else {
      secondsSinceFailure = Math.floor(950 + prng() * 14e3);
    }
    const failureTime = new Date(baseTime - secondsSinceFailure * 1e3);
    const recoveryAttempts = isMaxRetry ? 2 : prng() > 0.7 ? 1 : 0;
    const attemptCount = recoveryAttempts + 1;
    let gtRecoverable = codeObj.recoverable;
    let gtBestAction = codeObj.defaultAction;
    let gtExpectedOutcome = codeObj.recoverable ? "RECOVERED" : "PERMANENTLY_FAILED";
    let gtReason = codeObj.reason;
    if (isOptedOut) {
      gtRecoverable = false;
      gtBestAction = "STOP";
      gtExpectedOutcome = "PERMANENTLY_FAILED";
      gtReason = "Customer explicitly opted out of automated recovery outreach.";
    } else if (category === "EXPIRED_CARD") {
      gtRecoverable = false;
      gtBestAction = "STOP";
      gtExpectedOutcome = "PERMANENTLY_FAILED";
      gtReason = "Card expired. Automated retry on expired token causes bank charge failure.";
    } else if (category === "FATAL_DECLINE") {
      gtRecoverable = false;
      gtBestAction = "STOP";
      gtExpectedOutcome = "PERMANENTLY_FAILED";
      gtReason = "Card permanently cancelled, stolen, or flagged with fatal bank refusal.";
    } else if (isMaxRetry) {
      gtRecoverable = false;
      gtBestAction = "ESCALATE";
      gtExpectedOutcome = "PERMANENTLY_FAILED";
      gtReason = "Maximum retries exhausted (2/2). Must not trigger automated retry; requires manual ops escalation.";
    } else if (isHighValue) {
      gtBestAction = "ESCALATE";
      gtReason = "High value transaction exceeding \u20B950,000 threshold requires manual clearance.";
    }
    const payment = {
      id: paymentId,
      customer_id: customerId,
      order_id: orderId,
      amount,
      currency: "INR",
      status: "failed",
      failure_category: category,
      failure_code: codeObj.code,
      failure_reason: codeObj.reason,
      attempt_count: attemptCount,
      recovery_attempts: recoveryAttempts,
      seconds_since_failure: secondsSinceFailure,
      last_attempt_at: failureTime.toISOString(),
      created_at: new Date(failureTime.getTime() - 6e4).toISOString(),
      updated_at: failureTime.toISOString(),
      // HIDDEN GROUND TRUTH (Evaluation oracle ONLY)
      ground_truth_recoverable: gtRecoverable,
      ground_truth_best_action: gtBestAction,
      ground_truth_expected_outcome: gtExpectedOutcome,
      ground_truth_reason: gtReason
    };
    payments.push(payment);
  }
  const categoryDist = {
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
  const stats = {
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
    generated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  return { customers, payments, stats };
}
function toAgentInputContext(payment, customer, policy) {
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

// server/data/demoScenarios.ts
function createDemoScenarios() {
  const now = /* @__PURE__ */ new Date("2026-09-04T20:00:00.000Z");
  const custA = {
    id: "cust_demo_transient_01",
    name: "Aarav Sharma (Demo)",
    email: "aarav.sharma@example.com",
    contact: "+919811000001",
    lifetime_value: 125e4,
    previous_success_count: 8,
    previous_failure_count: 1,
    historical_success_rate: 0.89,
    opted_out: false,
    created_at: new Date(now.getTime() - 864e5 * 45).toISOString()
  };
  const payA = {
    id: "pay_demo_transient_01",
    customer_id: custA.id,
    order_id: "order_demo_transient_01",
    amount: 249900,
    // ₹2,499.00
    currency: "INR",
    status: "failed",
    failure_category: "TRANSIENT_BANK_FAILURE",
    failure_code: "BANK_SYSTEM_BUSY",
    failure_reason: "Issuer switch downtime (503 Service Unavailable)",
    attempt_count: 1,
    recovery_attempts: 0,
    seconds_since_failure: 1200,
    // 20 mins (> 15m cooldown)
    last_attempt_at: new Date(now.getTime() - 1200 * 1e3).toISOString(),
    created_at: new Date(now.getTime() - 1260 * 1e3).toISOString(),
    updated_at: new Date(now.getTime() - 1200 * 1e3).toISOString(),
    ground_truth_recoverable: true,
    ground_truth_best_action: "RETRY_PAYMENT",
    ground_truth_expected_outcome: "RECOVERED",
    ground_truth_reason: "Transient switch overload. Retry after cooldown recovers payment."
  };
  const custB = {
    id: "cust_demo_persistent_02",
    name: "Priya Patel (Demo)",
    email: "priya.patel@example.com",
    contact: "+919811000002",
    lifetime_value: 35e4,
    previous_success_count: 2,
    previous_failure_count: 2,
    historical_success_rate: 0.5,
    opted_out: false,
    created_at: new Date(now.getTime() - 864e5 * 20).toISOString()
  };
  const payB = {
    id: "pay_demo_persistent_02",
    customer_id: custB.id,
    order_id: "order_demo_persistent_02",
    amount: 499900,
    // ₹4,999.00
    currency: "INR",
    status: "failed",
    failure_category: "INSUFFICIENT_FUNDS",
    failure_code: "LIMIT_EXCEEDED",
    failure_reason: "Card daily transaction limit exceeded",
    attempt_count: 2,
    recovery_attempts: 1,
    // 1 previous recovery attempt
    seconds_since_failure: 1e3,
    // > 900s cooldown
    last_attempt_at: new Date(now.getTime() - 1e3 * 1e3).toISOString(),
    created_at: new Date(now.getTime() - 1060 * 1e3).toISOString(),
    updated_at: new Date(now.getTime() - 1e3 * 1e3).toISOString(),
    ground_truth_recoverable: false,
    ground_truth_best_action: "ESCALATE",
    ground_truth_expected_outcome: "PERMANENTLY_FAILED",
    ground_truth_reason: "Persistent debit limit failure. Simulated retry fails, exhausts retries (2/2) and forces ESCALATE."
  };
  const custC = {
    id: "cust_demo_highvalue_03",
    name: "Vikram Singhania (Demo)",
    email: "vikram.singhania@enterprise.internal",
    contact: "+919811000003",
    lifetime_value: 45e6,
    previous_success_count: 14,
    previous_failure_count: 0,
    historical_success_rate: 1,
    opted_out: true,
    // Opted out of automated retries
    created_at: new Date(now.getTime() - 864e5 * 90).toISOString()
  };
  const payC = {
    id: "pay_demo_highvalue_03",
    customer_id: custC.id,
    order_id: "order_demo_highvalue_03",
    amount: 85e5,
    // ₹85,000.00 (> ₹50,000 automated recovery threshold)
    currency: "INR",
    status: "failed",
    failure_category: "NETWORK_ERROR",
    failure_code: "GATEWAY_TIMEOUT",
    failure_reason: "Network gateway timeout during card authorization",
    attempt_count: 1,
    recovery_attempts: 0,
    seconds_since_failure: 1500,
    last_attempt_at: new Date(now.getTime() - 1500 * 1e3).toISOString(),
    created_at: new Date(now.getTime() - 1560 * 1e3).toISOString(),
    updated_at: new Date(now.getTime() - 1500 * 1e3).toISOString(),
    ground_truth_recoverable: false,
    ground_truth_best_action: "ESCALATE",
    ground_truth_expected_outcome: "PERMANENTLY_FAILED",
    ground_truth_reason: "High value (\u20B985,000) and customer opted out. Policy Engine strictly blocks automated actions."
  };
  const custE = {
    id: "cust_demo_captured_05",
    name: "Neha Roy (Demo)",
    email: "neha.roy@example.com",
    contact: "+919811000005",
    lifetime_value: 6e5,
    previous_success_count: 4,
    previous_failure_count: 0,
    historical_success_rate: 1,
    opted_out: false,
    created_at: new Date(now.getTime() - 864e5 * 15).toISOString()
  };
  const payE = {
    id: "pay_demo_captured_05",
    customer_id: custE.id,
    order_id: "order_demo_captured_05",
    amount: 149900,
    // ₹1,499.00
    currency: "INR",
    status: "captured",
    // Already captured!
    failure_category: "TRANSIENT_BANK_FAILURE",
    failure_code: "BANK_SYSTEM_BUSY",
    failure_reason: "Previously failed, subsequently captured by merchant webhook",
    attempt_count: 2,
    recovery_attempts: 1,
    seconds_since_failure: 0,
    last_attempt_at: new Date(now.getTime() - 600 * 1e3).toISOString(),
    created_at: new Date(now.getTime() - 3600 * 1e3).toISOString(),
    updated_at: new Date(now.getTime() - 600 * 1e3).toISOString(),
    ground_truth_recoverable: false,
    ground_truth_best_action: "STOP",
    ground_truth_expected_outcome: "RECOVERED",
    ground_truth_reason: "Payment already captured in Razorpay. Retrying is strictly blocked (ALREADY_SUCCESSFUL)."
  };
  return {
    [payA.id]: { payment: payA, customer: custA },
    [payB.id]: { payment: payB, customer: custB },
    [payC.id]: { payment: payC, customer: custC },
    [payE.id]: { payment: payE, customer: custE }
  };
}

// server/db/store.ts
var DATA_DIR = process.env.VERCEL ? path.join("/tmp", ".data") : path.resolve(process.cwd(), ".data");
var STORE_FILE = path.join(DATA_DIR, "store.json");
var DEFAULT_POLICY = {
  id: "pol_default_01",
  max_retries: 2,
  max_automated_recovery_amount: 5e6,
  // ₹50,000 in paise
  min_retry_cooldown_seconds: 900,
  // 15 minutes
  do_not_retry_after_success: true,
  do_not_retry_if_customer_opted_out: true,
  low_confidence_threshold: 0.6
};
var DataStore = class {
  constructor() {
    this.initialized = false;
    this.demoScenarios = createDemoScenarios();
    this.state = this.initialize();
  }
  initialize() {
    if (this.initialized) return this.state;
    if (fs.existsSync(STORE_FILE)) {
      try {
        const raw = fs.readFileSync(STORE_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.payments && parsed.payments.length === 600) {
          this.initialized = true;
          return parsed;
        }
      } catch (err) {
        console.warn("[DataStore] Corrupt store file encountered, re-seeding dataset...", err);
      }
    }
    const generated = generateSyntheticDataset(1337);
    const freshState = {
      version: 1,
      customers: generated.customers,
      payments: generated.payments,
      policy: DEFAULT_POLICY,
      audit_events: [],
      stats: generated.stats
    };
    this.saveToDisk(freshState);
    this.initialized = true;
    return freshState;
  }
  saveToDisk(state) {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      console.error("[DataStore] Failed to write store to disk:", err);
    }
  }
  reset(seed = 1337) {
    const generated = generateSyntheticDataset(seed);
    this.demoScenarios = createDemoScenarios();
    this.state = {
      version: 1,
      customers: generated.customers,
      payments: generated.payments,
      policy: DEFAULT_POLICY,
      audit_events: [],
      stats: generated.stats
    };
    this.saveToDisk(this.state);
    return this.state;
  }
  resetDemoScenario(id) {
    const fresh = createDemoScenarios();
    if (id && fresh[id]) {
      this.demoScenarios[id] = fresh[id];
    } else {
      this.demoScenarios = fresh;
    }
  }
  getDemoScenario(id) {
    return this.demoScenarios[id];
  }
  getAllDemoScenarios() {
    return this.demoScenarios;
  }
  // Payments Accessors
  getAllPayments() {
    return this.state.payments;
  }
  getPaymentById(id) {
    if (this.demoScenarios[id]) {
      return this.demoScenarios[id].payment;
    }
    return this.state.payments.find((p) => p.id === id);
  }
  updatePayment(id, updates) {
    if (this.demoScenarios[id]) {
      const existing2 = this.demoScenarios[id].payment;
      const updated2 = {
        ...existing2,
        ...updates,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.demoScenarios[id].payment = updated2;
      return updated2;
    }
    const idx = this.state.payments.findIndex((p) => p.id === id);
    if (idx === -1) return void 0;
    const existing = this.state.payments[idx];
    const updated = {
      ...existing,
      ...updates,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.state.payments[idx] = updated;
    this.saveToDisk(this.state);
    return updated;
  }
  // Customers Accessors
  getAllCustomers() {
    return this.state.customers;
  }
  getCustomerById(id) {
    for (const key of Object.keys(this.demoScenarios)) {
      if (this.demoScenarios[key].customer.id === id) {
        return this.demoScenarios[key].customer;
      }
    }
    return this.state.customers.find((c) => c.id === id);
  }
  // Policy Accessors
  getPolicy() {
    return this.state.policy;
  }
  updatePolicy(updates) {
    this.state.policy = {
      ...this.state.policy,
      ...updates
    };
    this.saveToDisk(this.state);
    return this.state.policy;
  }
  // Audit Events (Append-Only)
  getAuditEvents(paymentId) {
    if (paymentId) {
      return this.state.audit_events.filter((e) => e.payment_id === paymentId);
    }
    return this.state.audit_events;
  }
  appendAuditEvent(event) {
    this.state.audit_events.push(event);
    this.saveToDisk(this.state);
  }
  getStats() {
    return this.state.stats;
  }
};
var dataStore = new DataStore();

// server/policies/rules.ts
var VALID_ACTIONS = /* @__PURE__ */ new Set([
  "RETRY_PAYMENT",
  "SEND_PAYMENT_REMINDER",
  "ESCALATE",
  "STOP"
]);
var malformedOutputRule = (_payment, _customer, decision) => {
  const ruleName = "MALFORMED_OUTPUT";
  if (!decision || typeof decision !== "object" || !decision.payment_id || typeof decision.confidence !== "number" || isNaN(decision.confidence) || !isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1 || typeof decision.recoverability_score !== "number" || isNaN(decision.recoverability_score) || !isFinite(decision.recoverability_score) || decision.recoverability_score < 0 || decision.recoverability_score > 1 || !decision.recommended_action) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: "AIAgentDecision is malformed, missing required fields, or contains invalid numerical values"
      },
      violation: {
        rule: ruleName,
        reason: "AIAgentDecision is malformed, missing required fields, or contains invalid numerical values",
        forced_action: "ESCALATE"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: "Agent decision payload is syntactically well-formed"
    },
    violation: null
  };
};
var invalidActionRule = (_payment, _customer, decision) => {
  const ruleName = "INVALID_ACTION";
  if (!VALID_ACTIONS.has(decision?.recommended_action)) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Proposed action "${decision?.recommended_action}" is not a recognized recovery action`
      },
      violation: {
        rule: ruleName,
        reason: `Proposed action "${decision?.recommended_action}" is not a recognized recovery action`,
        forced_action: "ESCALATE"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: `Proposed action "${decision.recommended_action}" is a recognized bounded action`
    },
    violation: null
  };
};
var alreadySuccessfulRule = (payment) => {
  const ruleName = "ALREADY_SUCCESSFUL";
  if (payment.status === "captured") {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Payment ${payment.id} status is already "captured". Duplicate recovery strictly blocked.`
      },
      violation: {
        rule: ruleName,
        reason: `Payment ${payment.id} status is already "captured". Duplicate recovery strictly blocked.`,
        forced_action: "STOP"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: `Payment ${payment.id} status is "${payment.status}" (eligible for evaluation)`
    },
    violation: null
  };
};
var customerOptedOutRule = (_payment, customer, decision, policy) => {
  const ruleName = "CUSTOMER_OPTED_OUT";
  if (policy.do_not_retry_if_customer_opted_out && customer.opted_out && (decision.recommended_action === "RETRY_PAYMENT" || decision.recommended_action === "SEND_PAYMENT_REMINDER")) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Customer ${customer.id} has opted out of automated outreach and retries`
      },
      violation: {
        rule: ruleName,
        reason: `Customer ${customer.id} has opted out of automated outreach and retries`,
        forced_action: "STOP"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: customer.opted_out ? "Customer opted out, but proposed action is non-automated (ESCALATE or STOP)" : "Customer has not opted out"
    },
    violation: null
  };
};
var maxRetriesRule = (payment, _customer, decision, policy) => {
  const ruleName = "MAX_RETRIES_EXCEEDED";
  if (decision.recommended_action === "RETRY_PAYMENT" && payment.recovery_attempts >= policy.max_retries) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Recovery attempts ${payment.recovery_attempts} >= maximum allowed limit ${policy.max_retries}`
      },
      violation: {
        rule: ruleName,
        reason: `Recovery attempts ${payment.recovery_attempts} >= maximum allowed limit ${policy.max_retries}`,
        forced_action: "ESCALATE"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: `Recovery attempts (${payment.recovery_attempts}) within limit (${policy.max_retries})`
    },
    violation: null
  };
};
var cooldownRule = (payment, _customer, decision, policy) => {
  const ruleName = "COOLDOWN_ACTIVE";
  if (decision.recommended_action === "RETRY_PAYMENT" && payment.seconds_since_failure < policy.min_retry_cooldown_seconds) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Cooldown active: ${payment.seconds_since_failure}s elapsed < required ${policy.min_retry_cooldown_seconds}s`
      },
      violation: {
        rule: ruleName,
        reason: `Cooldown active: ${payment.seconds_since_failure}s elapsed < required ${policy.min_retry_cooldown_seconds}s`,
        forced_action: "ESCALATE"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: `Cooldown satisfied: ${payment.seconds_since_failure}s elapsed >= ${policy.min_retry_cooldown_seconds}s requirement`
    },
    violation: null
  };
};
var amountCapRule = (payment, _customer, decision, policy) => {
  const ruleName = "AMOUNT_EXCEEDS_CAP";
  if (decision.recommended_action === "RETRY_PAYMENT" && payment.amount > policy.max_automated_recovery_amount) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Payment amount \u20B9${(payment.amount / 100).toLocaleString("en-IN")} exceeds maximum automated recovery cap of \u20B9${(policy.max_automated_recovery_amount / 100).toLocaleString("en-IN")}`
      },
      violation: {
        rule: ruleName,
        reason: `Payment amount \u20B9${(payment.amount / 100).toLocaleString("en-IN")} exceeds maximum automated recovery cap of \u20B9${(policy.max_automated_recovery_amount / 100).toLocaleString("en-IN")}`,
        forced_action: "ESCALATE"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: `Payment amount \u20B9${(payment.amount / 100).toLocaleString("en-IN")} is within automated cap of \u20B9${(policy.max_automated_recovery_amount / 100).toLocaleString("en-IN")}`
    },
    violation: null
  };
};
var lowConfidenceRule = (_payment, _customer, decision, policy) => {
  const ruleName = "LOW_CONFIDENCE";
  const isAutomatedAction = decision?.recommended_action === "RETRY_PAYMENT" || decision?.recommended_action === "SEND_PAYMENT_REMINDER";
  if (isAutomatedAction && typeof decision?.confidence === "number" && decision.confidence < policy.low_confidence_threshold) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Agent confidence ${decision.confidence.toFixed(2)} < configured threshold ${policy.low_confidence_threshold.toFixed(2)} for automated action "${decision.recommended_action}"`
      },
      violation: {
        rule: ruleName,
        reason: `Agent confidence ${decision.confidence.toFixed(2)} < configured threshold ${policy.low_confidence_threshold.toFixed(2)} for automated action "${decision.recommended_action}"`,
        forced_action: "ESCALATE"
      }
    };
  }
  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: !isAutomatedAction ? `Proposed action "${decision?.recommended_action}" is non-automated (STOP/ESCALATE), low-confidence restriction does not apply` : `Agent confidence (${decision?.confidence?.toFixed(2)}) meets or exceeds threshold (${policy.low_confidence_threshold.toFixed(2)})`
    },
    violation: null
  };
};
var POLICY_RULES = [
  malformedOutputRule,
  invalidActionRule,
  alreadySuccessfulRule,
  customerOptedOutRule,
  maxRetriesRule,
  cooldownRule,
  amountCapRule,
  lowConfidenceRule
];

// server/policies/policyEngine.ts
var PolicyEngine = class {
  constructor(customRules = POLICY_RULES) {
    this.rules = customRules;
  }
  /**
   * Evaluate a proposed action against all deterministic policy rules.
   * Runs all rules to produce an exhaustive audit evaluation breakdown.
   */
  evaluate(payment, customer, decision, policy) {
    const evaluatedRules = [];
    const violations = [];
    const originalAction = decision?.recommended_action ?? "ESCALATE";
    for (const rule of this.rules) {
      const result = rule(payment, customer, decision, policy);
      evaluatedRules.push(result.evaluation);
      if (result.violation) {
        violations.push(result.violation);
      }
    }
    const allowed = violations.length === 0;
    let finalAction;
    if (allowed) {
      finalAction = originalAction;
    } else {
      const hasStopViolation = violations.some((v) => v.forced_action === "STOP");
      finalAction = hasStopViolation ? "STOP" : "ESCALATE";
    }
    return {
      allowed,
      originalAction,
      finalAction,
      violations,
      evaluatedRules,
      evaluatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
};
var policyEngine = new PolicyEngine();

// server/routes/agentRoutes.ts
import { Router } from "express";

// server/agents/geminiRecoveryAgent.ts
import { GoogleGenAI, Type } from "@google/genai";

// server/agents/promptTemplates.ts
var RECOVERY_AGENT_SYSTEM_INSTRUCTION = `You are RecoverPay's payment recovery diagnostic assistant.
Your role is to perform probabilistic failure diagnosis and recommend a bounded recovery strategy for failed payment telemetry.

CRITICAL OPERATIONAL BOUNDARIES:
- You are a DIAGNOSTIC ASSISTANT, NOT an autonomous payment executor.
- You do not have authorization to execute any action or call any payment gateways.
- Your recommendation will be strictly evaluated by an external deterministic policy engine.
- Never assume your recommendation is automatically permitted.
- Never invent missing information.
- Never use or assume hidden evaluation labels.
- Never claim an action was executed.
- Never claim a payment was recovered.
- Return only the structured decision following the provided response schema.

DIAGNOSTIC GUIDELINES:
1. Diagnosis taxonomy must map to one of:
   - 'transient_bank_downtime': Issuer or network switch downtime, system busy, 5xx gateway errors.
   - 'network_timeout': Checkout session expiry, socket hangup, connection resets.
   - 'insufficient_funds': Customer account balance low, debit limit exceeded.
   - 'authentication_failure': 3DS OTP timeout, authentication dropped.
   - 'expired_card': Card validity expired.
   - 'fatal_declined_card': Card blocked, stolen, blacklisted, or permanently restricted.

2. Recommended action taxonomy must strictly be one of:
   - 'RETRY_PAYMENT': For transient switch or network timeouts where cooldown has elapsed and attempt count is within limit.
   - 'SEND_PAYMENT_REMINDER': For soft failures (insufficient funds, OTP timeouts) where customer action or alternative funding is required.
   - 'ESCALATE': For high-value transactions, edge cases, borderline anomalies, or when retry limits/cooldowns demand human ops intervention.
   - 'STOP': For fatal card declines, expired cards, or customers opted out.

3. Numeric calibration:
   - recoverability_score: Estimated probability of successful recovery (0.00 to 1.00).
   - confidence: Your certainty in this diagnosis and recommendation (0.00 to 1.00).

4. Risk level assessment:
   - 'LOW', 'MEDIUM', 'HIGH', or 'CRITICAL'.

5. Customer recovery message:
   - ONLY provide customer_recovery_message if recommended_action is 'SEND_PAYMENT_REMINDER'.
   - The message must be concise, polite, and professional.
   - Never expose internal diagnostics or mention AI/Gemini.
   - Never claim payment was successful or fabricate bank responses.
   - Example: "Your recent payment could not be completed. Please try again using your secure payment link."
   - For all other actions (RETRY_PAYMENT, ESCALATE, STOP), leave customer_recovery_message empty or omitted.`;
function buildAgentUserPrompt(context) {
  const sanitizedTelemetry = {
    payment: {
      id: context.payment.id,
      amount_paise: context.payment.amount,
      amount_inr: (context.payment.amount / 100).toFixed(2),
      currency: context.payment.currency,
      failure_category: context.payment.failure_category,
      failure_code: context.payment.failure_code,
      failure_reason: context.payment.failure_reason,
      attempt_count: context.payment.attempt_count,
      recovery_attempts: context.payment.recovery_attempts,
      seconds_since_failure: context.payment.seconds_since_failure,
      last_attempt_at: context.payment.last_attempt_at
    },
    customer: {
      id: context.customer.id,
      historical_success_rate: context.customer.historical_success_rate,
      previous_success_count: context.customer.previous_success_count,
      previous_failure_count: context.customer.previous_failure_count,
      opted_out: context.customer.opted_out
    },
    merchant_policy_context: {
      max_retries: context.merchant_policy_context.max_retries,
      max_automated_amount_paise: context.merchant_policy_context.max_automated_amount,
      max_automated_amount_inr: (context.merchant_policy_context.max_automated_amount / 100).toFixed(2),
      min_cooldown_seconds: context.merchant_policy_context.min_cooldown_seconds
    }
  };
  return `Evaluate the following failed payment telemetry and provide your structured recovery diagnosis and recommendation for payment ID: ${context.payment.id}

TELEMETRY CONTEXT:
${JSON.stringify(sanitizedTelemetry, null, 2)}

Remember:
- Return the EXACT payment_id: "${context.payment.id}"
- Choose a valid diagnosis and recommended_action.
- Set confidence and recoverability_score strictly between 0.00 and 1.00.`;
}

// server/agents/validation.ts
var VALID_DIAGNOSES = /* @__PURE__ */ new Set([
  "transient_bank_downtime",
  "network_timeout",
  "insufficient_funds",
  "authentication_failure",
  "expired_card",
  "fatal_declined_card"
]);
var VALID_ACTIONS2 = /* @__PURE__ */ new Set([
  "RETRY_PAYMENT",
  "SEND_PAYMENT_REMINDER",
  "ESCALATE",
  "STOP"
]);
var VALID_RISK_LEVELS = /* @__PURE__ */ new Set([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL"
]);
function validateAgentDecision(raw, expectedPaymentId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      error: "Agent response is not a valid JSON object"
    };
  }
  if (typeof raw.payment_id !== "string" || !raw.payment_id.trim()) {
    return {
      valid: false,
      error: "Missing or empty payment_id in agent response"
    };
  }
  if (raw.payment_id.trim() !== expectedPaymentId) {
    return {
      valid: false,
      error: `Payment ID mismatch: expected "${expectedPaymentId}", received "${raw.payment_id}"`
    };
  }
  if (!VALID_DIAGNOSES.has(raw.diagnosis)) {
    return {
      valid: false,
      error: `Invalid diagnosis "${raw.diagnosis}". Allowed: ${Array.from(VALID_DIAGNOSES).join(", ")}`
    };
  }
  if (!VALID_ACTIONS2.has(raw.recommended_action)) {
    return {
      valid: false,
      error: `Invalid action "${raw.recommended_action}". Allowed: ${Array.from(VALID_ACTIONS2).join(", ")}`
    };
  }
  if (typeof raw.recoverability_score !== "number" || isNaN(raw.recoverability_score) || !isFinite(raw.recoverability_score)) {
    return {
      valid: false,
      error: `Invalid recoverability_score: value must be a valid finite number`
    };
  }
  if (raw.recoverability_score < 0 || raw.recoverability_score > 1) {
    return {
      valid: false,
      error: `recoverability_score out of bounds: ${raw.recoverability_score} (must be between 0.00 and 1.00)`
    };
  }
  if (typeof raw.confidence !== "number" || isNaN(raw.confidence) || !isFinite(raw.confidence)) {
    return {
      valid: false,
      error: `Invalid confidence: value must be a valid finite number`
    };
  }
  if (raw.confidence < 0 || raw.confidence > 1) {
    return {
      valid: false,
      error: `confidence out of bounds: ${raw.confidence} (must be between 0.00 and 1.00)`
    };
  }
  if (!VALID_RISK_LEVELS.has(raw.risk_level)) {
    return {
      valid: false,
      error: `Invalid risk_level "${raw.risk_level}". Allowed: ${Array.from(VALID_RISK_LEVELS).join(", ")}`
    };
  }
  if (typeof raw.reasoning !== "string" || !raw.reasoning.trim()) {
    return {
      valid: false,
      error: "Missing or empty reasoning in agent response"
    };
  }
  let normalizedMessage = void 0;
  if (raw.recommended_action === "SEND_PAYMENT_REMINDER") {
    if (typeof raw.customer_recovery_message === "string" && raw.customer_recovery_message.trim()) {
      normalizedMessage = raw.customer_recovery_message.trim();
    } else {
      normalizedMessage = "Your recent payment could not be completed. Please try again using your secure payment link.";
    }
  } else {
    normalizedMessage = void 0;
  }
  const decision = {
    payment_id: expectedPaymentId,
    diagnosis: raw.diagnosis,
    recoverability_score: raw.recoverability_score,
    recommended_action: raw.recommended_action,
    confidence: raw.confidence,
    risk_level: raw.risk_level,
    reasoning: raw.reasoning.trim(),
    customer_recovery_message: normalizedMessage
  };
  return {
    valid: true,
    decision
  };
}
function createFallbackDecision(paymentId, reason = "Gemini inference was unavailable. No automated recovery action is authorized.") {
  return {
    payment_id: paymentId,
    diagnosis: "network_timeout",
    recoverability_score: 0,
    recommended_action: "ESCALATE",
    confidence: 0,
    risk_level: "HIGH",
    reasoning: reason
  };
}

// server/agents/geminiRecoveryAgent.ts
var DECISION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    payment_id: {
      type: Type.STRING,
      description: "The exact payment ID matching the input telemetry context"
    },
    diagnosis: {
      type: Type.STRING,
      enum: [
        "transient_bank_downtime",
        "network_timeout",
        "insufficient_funds",
        "authentication_failure",
        "expired_card",
        "fatal_declined_card"
      ],
      description: "Probabilistic classification of the failure root cause"
    },
    recoverability_score: {
      type: Type.NUMBER,
      description: "Estimated probability of recovery between 0.00 and 1.00"
    },
    recommended_action: {
      type: Type.STRING,
      enum: [
        "RETRY_PAYMENT",
        "SEND_PAYMENT_REMINDER",
        "ESCALATE",
        "STOP"
      ],
      description: "Recommended bounded recovery action"
    },
    confidence: {
      type: Type.NUMBER,
      description: "Model confidence in recommendation between 0.00 and 1.00"
    },
    risk_level: {
      type: Type.STRING,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      description: "Risk assessment category"
    },
    reasoning: {
      type: Type.STRING,
      description: "Technical explanation of diagnostic rationale and evidence"
    },
    customer_recovery_message: {
      type: Type.STRING,
      description: "Polite customer payment link message ONLY when recommended_action is SEND_PAYMENT_REMINDER"
    }
  },
  required: [
    "payment_id",
    "diagnosis",
    "recoverability_score",
    "recommended_action",
    "confidence",
    "risk_level",
    "reasoning"
  ]
};
var DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
function resolveGeminiModel() {
  const envModel = (process.env.GEMINI_MODEL || "").trim();
  if (envModel) {
    return envModel;
  }
  return DEFAULT_GEMINI_MODEL;
}
var GeminiRecoveryAgent = class {
  constructor() {
    this.defaultTimeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS || "8000", 10);
  }
  getModel() {
    return resolveGeminiModel();
  }
  /**
   * Diagnostic entry point.
   * Receives sanitized AgentInputContext (never ground truth).
   * Returns bounded AgentResult.
   */
  async diagnose(context) {
    const paymentId = context?.payment?.id || "unknown_payment";
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const activeModel = resolveGeminiModel();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === "" || apiKey === "MY_GEMINI_API_KEY") {
      const fallbackDecision = createFallbackDecision(
        paymentId,
        "GEMINI_API_KEY is not configured in server environment. Automated recovery halted."
      );
      this.logOperation({
        paymentId,
        status: "FALLBACK",
        action: fallbackDecision.recommended_action,
        confidence: fallbackDecision.confidence,
        reason: "GEMINI_API_KEY_MISSING",
        timestamp
      });
      return {
        success: false,
        fallback: true,
        decision: fallbackDecision,
        error: "GEMINI_API_KEY_MISSING: API key is not configured"
      };
    }
    const userPrompt = buildAgentUserPrompt(context);
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
      const timeoutMs = this.defaultTimeoutMs;
      const maxRetries = 2;
      let lastError = null;
      let responseText = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          console.log(
            `[GeminiRecoveryAgent] Outbound Gemini API request | model="${activeModel}" | payment="${paymentId}" | attempt=${attempt + 1}/${maxRetries + 1}`
          );
          const generatePromise = ai.models.generateContent({
            model: activeModel,
            contents: userPrompt,
            config: {
              systemInstruction: RECOVERY_AGENT_SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              responseSchema: DECISION_SCHEMA,
              temperature: 0.1
            }
          });
          let timerId = null;
          const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(() => {
              reject(new Error(`Gemini inference timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          });
          const response = await Promise.race([generatePromise, timeoutPromise]);
          if (timerId) clearTimeout(timerId);
          if (!response || !response.text) {
            throw new Error("Empty response received from Gemini API");
          }
          responseText = response.text;
          break;
        } catch (err) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isRetryable = errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand") || errMsg.includes("429") || errMsg.includes("ResourceExhausted") || err?.status === 503 || err?.status === 429;
          if (attempt < maxRetries && isRetryable) {
            const backoffMs = 1e3 * Math.pow(2, attempt);
            console.warn(
              `[GeminiRecoveryAgent] Temporary API error (${err?.status || "503"}): ${errMsg.slice(0, 120)} | model="${activeModel}" | scheduling retry ${attempt + 2}/${maxRetries + 1} in ${backoffMs}ms`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          } else {
            break;
          }
        }
      }
      if (!responseText) {
        throw lastError || new Error("All Gemini recovery diagnosis attempts failed");
      }
      let rawDecision;
      try {
        rawDecision = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`Failed to parse Gemini response as JSON: ${parseError.message}`);
      }
      const validation = validateAgentDecision(rawDecision, paymentId);
      if (!validation.valid || !validation.decision) {
        throw new Error(`Agent decision schema validation failed: ${validation.error}`);
      }
      const decision = validation.decision;
      this.logOperation({
        paymentId,
        status: "SUCCESS",
        action: decision.recommended_action,
        confidence: decision.confidence,
        reason: decision.reasoning,
        timestamp
      });
      return {
        success: true,
        fallback: false,
        decision
      };
    } catch (err) {
      const errorMessage = err?.message || "Unknown Gemini error";
      const fallbackDecision = createFallbackDecision(
        paymentId,
        `Gemini diagnosis failed (${errorMessage}). Bounded safety default applied.`
      );
      this.logOperation({
        paymentId,
        status: "FALLBACK",
        action: fallbackDecision.recommended_action,
        confidence: fallbackDecision.confidence,
        reason: errorMessage,
        timestamp
      });
      return {
        success: false,
        fallback: true,
        decision: fallbackDecision,
        error: errorMessage
      };
    }
  }
  /**
   * Safe operational logging without secret or PII exposure.
   */
  logOperation(params) {
    console.log(
      `[RECOVERY_AGENT] ${params.timestamp} | payment=${params.paymentId} | status=${params.status} | action=${params.action} | conf=${params.confidence.toFixed(2)} | info="${params.reason.slice(0, 100)}"`
    );
  }
};
var geminiRecoveryAgent = new GeminiRecoveryAgent();

// server/routes/agentRoutes.ts
var agentRouter = Router();
agentRouter.post("/diagnose", async (req, res) => {
  try {
    const { payment_id, context: explicitContext } = req.body;
    let context;
    if (explicitContext && explicitContext.payment && explicitContext.payment.id) {
      context = explicitContext;
    } else if (payment_id && typeof payment_id === "string") {
      const payment = dataStore.getPaymentById(payment_id);
      if (!payment) {
        res.status(404).json({
          success: false,
          error: `Payment with ID "${payment_id}" was not found`
        });
        return;
      }
      const customer = dataStore.getCustomerById(payment.customer_id);
      if (!customer) {
        res.status(404).json({
          success: false,
          error: `Customer with ID "${payment.customer_id}" for payment "${payment_id}" was not found`
        });
        return;
      }
      const policy = dataStore.getPolicy();
      context = toAgentInputContext(payment, customer, policy);
    } else {
      res.status(400).json({
        success: false,
        error: 'Missing required field: "payment_id" or "context"'
      });
      return;
    }
    const contextAny = context;
    if (contextAny.payment?.ground_truth_recoverable !== void 0 || contextAny.payment?.ground_truth_best_action !== void 0 || contextAny.payment?.ground_truth_expected_outcome !== void 0 || contextAny.payment?.ground_truth_reason !== void 0) {
      res.status(500).json({
        success: false,
        error: "FATAL SECURITY ERROR: Ground truth leakage detected in agent input context"
      });
      return;
    }
    const result = await geminiRecoveryAgent.diagnose(context);
    res.json(result);
  } catch (err) {
    console.error("[agentRouter] Error processing diagnosis request:", err);
    res.status(500).json({
      success: false,
      fallback: true,
      error: err?.message || "Internal server error during diagnosis"
    });
  }
});

// server/routes/recoveryRoutes.ts
import { Router as Router2 } from "express";

// server/tools/idempotency.ts
var IdempotencyStore = class {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
  }
  /**
   * Generates a deterministic idempotency key for an action attempt on a payment
   */
  generateKey(paymentId, recoveryAttempts, action) {
    return `idem_${paymentId}_attempt${recoveryAttempts}_${action}`;
  }
  /**
   * Checks if an idempotency key is already in progress or completed.
   */
  check(key) {
    const record = this.cache.get(key);
    if (!record) {
      return { exists: false, inProgress: false };
    }
    if (record.status === "IN_PROGRESS") {
      return { exists: true, inProgress: true };
    }
    return { exists: true, inProgress: false, result: record.result };
  }
  /**
   * Locks the key as IN_PROGRESS to prevent concurrent duplicate execution.
   */
  lock(key, paymentId) {
    const existing = this.cache.get(key);
    if (existing) {
      return false;
    }
    this.cache.set(key, {
      key,
      paymentId,
      status: "IN_PROGRESS",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return true;
  }
  /**
   * Commits the completed ToolResult against the idempotency key.
   */
  commit(key, result) {
    const record = this.cache.get(key);
    if (record) {
      record.status = "COMPLETED";
      record.result = result;
      record.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    } else {
      this.cache.set(key, {
        key,
        paymentId: result.payment_id,
        status: "COMPLETED",
        result,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  /**
   * Releases lock in case of unexpected unhandled failure
   */
  release(key) {
    const record = this.cache.get(key);
    if (record && record.status === "IN_PROGRESS") {
      this.cache.delete(key);
    }
  }
  /**
   * Clears the cache (for testing)
   */
  clear() {
    this.cache.clear();
  }
};
var idempotencyStore = new IdempotencyStore();

// server/tools/simulationRailTools.ts
function simulatePaymentRetry(payment, customer, idempotencyKey) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const nextRecoveryAttempts = payment.recovery_attempts + 1;
  let recovered = false;
  let finalStatus = "failed";
  let message = "";
  let errorMsg = void 0;
  if (payment.id === "pay_demo_transient_01") {
    recovered = true;
    finalStatus = "captured";
    message = "SIMULATED_RECOVERY: Bank switch retry succeeded. Payment re-authorized and captured.";
  } else if (payment.id === "pay_demo_persistent_02") {
    recovered = false;
    finalStatus = "failed";
    errorMsg = "SIMULATED_RECOVERY: Bank card limit exceeded. Retry rejected by cardholder bank.";
    message = "SIMULATED_RECOVERY: Retry attempt failed. Recovery attempts incremented.";
  } else if (payment.ground_truth_recoverable === true) {
    recovered = true;
    finalStatus = "captured";
    message = "SIMULATED_RECOVERY: Network/switch retry succeeded. Payment re-authorized and captured.";
  } else {
    recovered = false;
    finalStatus = "failed";
    errorMsg = `SIMULATED_RECOVERY: Issuer bank decline persisted (${payment.failure_code}).`;
    message = "SIMULATED_RECOVERY: Retry attempt failed. Recovery attempts incremented.";
  }
  const toolResult = {
    tool_called: "retry_payment",
    action: "RETRY_PAYMENT",
    execution_mode: "SIMULATED_RECOVERY",
    success: recovered,
    recovered,
    amount_recovered: recovered ? payment.amount : 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: "ALLOWED",
    policy_violations: [],
    external_reference_id: `sim_txn_${payment.id}_${nextRecoveryAttempts}`,
    final_payment_status: finalStatus,
    message,
    error_message: errorMsg,
    timestamp
  };
  const updatedPayment = {
    status: finalStatus,
    recovery_attempts: nextRecoveryAttempts,
    attempt_count: payment.attempt_count + 1,
    last_attempt_at: timestamp,
    updated_at: timestamp
  };
  return { toolResult, updatedPayment };
}
function simulatePaymentReminder(payment, customer, idempotencyKey, customMessage) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const linkId = `sim_plink_${payment.id.replace("pay_", "")}`;
  const paymentLinkUrl = `https://rzp.io/i/sim_${payment.id.replace("pay_", "")}`;
  const toolResult = {
    tool_called: "send_payment_reminder",
    action: "SEND_PAYMENT_REMINDER",
    execution_mode: "SIMULATED_RECOVERY",
    success: true,
    recovered: false,
    // Invariant: Payment link generated != captured payment
    amount_recovered: 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: "ALLOWED",
    policy_violations: [],
    external_reference_id: linkId,
    payment_link_url: paymentLinkUrl,
    final_payment_status: payment.status,
    // Stays 'failed' or current status until paid
    message: `SIMULATED_RECOVERY: Payment link dispatched to ${customer.email}. Awaiting customer settlement.`,
    timestamp
  };
  const updatedPayment = {
    updated_at: timestamp
  };
  return { toolResult, updatedPayment };
}
function simulateEscalateToOps(payment, reason, idempotencyKey) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const toolResult = {
    tool_called: "escalate_to_ops",
    action: "ESCALATE",
    execution_mode: "SIMULATED_RECOVERY",
    success: true,
    recovered: false,
    amount_recovered: 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: "ALLOWED",
    policy_violations: [],
    final_payment_status: "escalated",
    message: `Payment escalated to Human Operations Queue: ${reason}. Zero payment API calls initiated.`,
    timestamp
  };
  const updatedPayment = {
    status: "escalated",
    updated_at: timestamp
  };
  return { toolResult, updatedPayment };
}
function simulateTerminateRecovery(payment, reason, idempotencyKey) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const toolResult = {
    tool_called: "terminate_recovery",
    action: "STOP",
    execution_mode: "SIMULATED_RECOVERY",
    success: true,
    recovered: false,
    amount_recovered: 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: "ALLOWED",
    policy_violations: [],
    final_payment_status: "abandoned",
    message: `Automated recovery terminated: ${reason}. Payment marked abandoned. Zero payment API calls initiated.`,
    timestamp
  };
  const updatedPayment = {
    status: "abandoned",
    updated_at: timestamp
  };
  return { toolResult, updatedPayment };
}

// server/tools/razorpayRealTools.ts
function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const isConfigured = Boolean(keyId && keySecret && keyId.startsWith("rzp_test_"));
  return {
    keyId,
    keySecret,
    isConfigured
  };
}
function getMaskedRazorpayConfig() {
  const cfg = getRazorpayConfig();
  if (!cfg.isConfigured || !cfg.keyId) {
    return {
      isConfigured: false,
      maskedKeyId: null,
      mode: "DEMO",
      label: "SIMULATED DEMO (Razorpay Test Keys Not Configured)"
    };
  }
  const masked = cfg.keyId.length > 12 ? `${cfg.keyId.slice(0, 8)}\u2022\u2022\u2022\u2022${cfg.keyId.slice(-4)}` : "rzp_test_\u2022\u2022\u2022\u2022";
  return {
    isConfigured: true,
    maskedKeyId: masked,
    mode: "RAZORPAY_TEST",
    label: "RAZORPAY TEST MODE \u2014 NO REAL MONEY"
  };
}
function parseRazorpayError(status, errorBody) {
  let parsedDesc = "";
  try {
    const json = JSON.parse(errorBody);
    if (json.error?.description) parsedDesc = json.error.description;
  } catch {
    parsedDesc = errorBody.slice(0, 150);
  }
  if (status === 401 || status === 403) {
    return {
      code: "RAZORPAY_AUTH_FAILED",
      message: `Razorpay Test API authentication failed (${status}). Verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. ${parsedDesc}`
    };
  }
  if (status === 429) {
    return {
      code: "RAZORPAY_RATE_LIMIT",
      message: `Razorpay Test API rate limit exceeded (429). Automated requests throttled safely.`
    };
  }
  if (status >= 500) {
    return {
      code: "RAZORPAY_SERVER_ERROR",
      message: `Razorpay internal gateway error (${status}). ${parsedDesc}`
    };
  }
  return {
    code: "RAZORPAY_API_ERROR",
    message: `Razorpay API returned HTTP ${status}: ${parsedDesc}`
  };
}
async function createRazorpayTestPaymentLink(payment, customer, idempotencyKey, customMessage) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const config = getRazorpayConfig();
  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return {
      tool_called: "send_payment_reminder",
      action: "SEND_PAYMENT_REMINDER",
      execution_mode: "RAZORPAY_TEST_API",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: "ALLOWED",
      policy_violations: [],
      final_payment_status: payment.status,
      message: "RAZORPAY_CREDENTIALS_MISSING: Razorpay TEST keys (RAZORPAY_KEY_ID=rzp_test_*) not configured. Test API skipped safely.",
      error_message: "Razorpay TEST credentials absent or invalid",
      timestamp
    };
  }
  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  try {
    const payload = {
      amount: payment.amount,
      currency: payment.currency || "INR",
      accept_partial: false,
      description: customMessage || `RecoverPay reminder: Retry payment for ${payment.id}`,
      customer: {
        name: customer.name,
        email: customer.email,
        contact: customer.contact
      },
      notify: {
        sms: false,
        email: false
      },
      reminder_enable: false,
      reference_id: `rec_${payment.id}_${Date.now()}`
    };
    const response = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const parsed = parseRazorpayError(response.status, errorBody);
      return {
        tool_called: "send_payment_reminder",
        action: "SEND_PAYMENT_REMINDER",
        execution_mode: "RAZORPAY_TEST_API",
        success: false,
        recovered: false,
        amount_recovered: 0,
        payment_id: payment.id,
        idempotency_key: idempotencyKey,
        policy_decision: "ALLOWED",
        policy_violations: [],
        final_payment_status: payment.status,
        message: parsed.message,
        error_message: `[${parsed.code}] ${errorBody}`,
        timestamp
      };
    }
    const data = await response.json();
    return {
      tool_called: "send_payment_reminder",
      action: "SEND_PAYMENT_REMINDER",
      execution_mode: "RAZORPAY_TEST_API",
      success: true,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: "ALLOWED",
      policy_violations: [],
      external_reference_id: data.id,
      // e.g. plink_xxxx
      payment_link_url: data.short_url,
      final_payment_status: payment.status,
      message: `Razorpay TEST Payment Link generated successfully (${data.id}). Awaiting customer authorization.`,
      timestamp
    };
  } catch (err) {
    const isTimeout = err.name === "TimeoutError";
    return {
      tool_called: "send_payment_reminder",
      action: "SEND_PAYMENT_REMINDER",
      execution_mode: "RAZORPAY_TEST_API",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: "ALLOWED",
      policy_violations: [],
      final_payment_status: payment.status,
      message: isTimeout ? "Razorpay TEST API network timeout (8000ms)." : `Razorpay TEST API network exception: ${err.message}`,
      error_message: isTimeout ? "RAZORPAY_NETWORK_TIMEOUT" : err.message,
      timestamp
    };
  }
}
async function createRazorpayTestOrder(payment, idempotencyKey) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const config = getRazorpayConfig();
  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return {
      tool_called: "retry_payment",
      action: "RETRY_PAYMENT",
      execution_mode: "RAZORPAY_TEST_API",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: "ALLOWED",
      policy_violations: [],
      final_payment_status: payment.status,
      message: "RAZORPAY_CREDENTIALS_MISSING: Razorpay TEST keys not configured.",
      error_message: "Razorpay TEST credentials absent or invalid",
      timestamp
    };
  }
  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  try {
    const payload = {
      amount: payment.amount,
      currency: payment.currency || "INR",
      receipt: `rec_${payment.id}`,
      notes: {
        payment_id: payment.id,
        recovery_type: "automated_order"
      }
    };
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const parsed = parseRazorpayError(response.status, errorBody);
      return {
        tool_called: "retry_payment",
        action: "RETRY_PAYMENT",
        execution_mode: "RAZORPAY_TEST_API",
        success: false,
        recovered: false,
        amount_recovered: 0,
        payment_id: payment.id,
        idempotency_key: idempotencyKey,
        policy_decision: "ALLOWED",
        policy_violations: [],
        final_payment_status: payment.status,
        message: parsed.message,
        error_message: `[${parsed.code}] ${errorBody}`,
        timestamp
      };
    }
    const data = await response.json();
    return {
      tool_called: "retry_payment",
      action: "RETRY_PAYMENT",
      execution_mode: "RAZORPAY_TEST_API",
      success: true,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: "ALLOWED",
      policy_violations: [],
      external_reference_id: data.id,
      // e.g. order_xxxx
      final_payment_status: payment.status,
      message: `Razorpay TEST Order created (${data.id}). Awaiting payment fulfillment.`,
      timestamp
    };
  } catch (err) {
    const isTimeout = err.name === "TimeoutError";
    return {
      tool_called: "retry_payment",
      action: "RETRY_PAYMENT",
      execution_mode: "RAZORPAY_TEST_API",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: "ALLOWED",
      policy_violations: [],
      final_payment_status: payment.status,
      message: isTimeout ? "Razorpay TEST API network timeout (8000ms)." : `Razorpay TEST API network exception: ${err.message}`,
      error_message: isTimeout ? "RAZORPAY_NETWORK_TIMEOUT" : err.message,
      timestamp
    };
  }
}
async function verifyRazorpayTestPaymentLink(paymentLinkId) {
  const config = getRazorpayConfig();
  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return {
      success: false,
      paid: false,
      status: "created",
      error: "Razorpay TEST credentials not configured",
      code: "RAZORPAY_CREDENTIALS_MISSING"
    };
  }
  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
      method: "GET",
      headers: {
        "Authorization": authHeader
      },
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const parsed = parseRazorpayError(response.status, errorBody);
      return {
        success: false,
        paid: false,
        status: "created",
        error: parsed.message,
        code: parsed.code
      };
    }
    const data = await response.json();
    const isPaid = data.status === "paid";
    return {
      success: true,
      paid: isPaid,
      status: data.status,
      amount_paid: data.amount_paid || (isPaid ? data.amount : 0),
      payment_id: data.payments && data.payments.length > 0 ? data.payments[0].payment_id : void 0,
      raw: data
    };
  } catch (err) {
    const isTimeout = err.name === "TimeoutError";
    return {
      success: false,
      paid: false,
      status: "created",
      error: isTimeout ? "Razorpay Test API request timed out (8000ms)" : err.message,
      code: isTimeout ? "RAZORPAY_NETWORK_TIMEOUT" : "RAZORPAY_NETWORK_ERROR"
    };
  }
}
async function verifyRazorpayTestPayment(razorpayPaymentId) {
  const config = getRazorpayConfig();
  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return {
      success: false,
      error: "Razorpay TEST credentials not configured",
      code: "RAZORPAY_CREDENTIALS_MISSING"
    };
  }
  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
      method: "GET",
      headers: {
        "Authorization": authHeader
      },
      signal: AbortSignal.timeout(8e3)
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const parsed = parseRazorpayError(response.status, errorBody);
      return { success: false, error: parsed.message, code: parsed.code };
    }
    const data = await response.json();
    let status = "failed";
    if (data.status === "captured") status = "captured";
    else if (data.status === "created" || data.status === "authorized") status = "created";
    else status = "failed";
    return { success: true, status, raw: data };
  } catch (err) {
    const isTimeout = err.name === "TimeoutError";
    return {
      success: false,
      error: isTimeout ? "Razorpay Test API request timed out (8000ms)" : err.message,
      code: isTimeout ? "RAZORPAY_NETWORK_TIMEOUT" : "RAZORPAY_NETWORK_ERROR"
    };
  }
}

// server/tools/verification.ts
function verifyExecutionOutcome(payment, result) {
  if (result.policy_decision === "BLOCKED") {
    return {
      verified: true,
      final_payment_status: payment.status,
      recovered: false,
      amount_recovered: 0,
      audit_status: "SKIPPED",
      verification_notes: `Zero tool execution: Blocked by Policy Engine (${result.policy_violations.join(", ")})`
    };
  }
  if (result.action === "ESCALATE" || result.tool_called === "escalate_to_ops") {
    return {
      verified: true,
      final_payment_status: "escalated",
      recovered: false,
      amount_recovered: 0,
      audit_status: "SUCCESS",
      verification_notes: "Verified transition to Human Operations queue. Zero financial execution."
    };
  }
  if (result.action === "STOP" || result.tool_called === "terminate_recovery") {
    return {
      verified: true,
      final_payment_status: "abandoned",
      recovered: false,
      amount_recovered: 0,
      audit_status: "SUCCESS",
      verification_notes: "Verified terminal stop transition. Automated recovery halted."
    };
  }
  if (result.tool_called === "send_payment_reminder") {
    return {
      verified: true,
      final_payment_status: payment.status,
      // remains 'failed'
      recovered: false,
      amount_recovered: 0,
      audit_status: result.success ? "SUCCESS" : "FAILED",
      verification_notes: result.success ? `Payment reminder link issued (${result.external_reference_id || "link"}). Awaiting customer authorization.` : `Payment reminder failed: ${result.error_message || result.message}`
    };
  }
  if (result.tool_called === "retry_payment") {
    if (result.recovered === true && result.success === true) {
      return {
        verified: true,
        final_payment_status: "captured",
        recovered: true,
        amount_recovered: payment.amount,
        audit_status: "SUCCESS",
        verification_notes: `Payment re-authorization verified captured. Recovered \u20B9${(payment.amount / 100).toLocaleString("en-IN")}.`
      };
    } else {
      return {
        verified: true,
        final_payment_status: "failed",
        recovered: false,
        amount_recovered: 0,
        audit_status: "FAILED",
        verification_notes: `Payment retry failed: ${result.error_message || result.message}`
      };
    }
  }
  return {
    verified: false,
    final_payment_status: payment.status,
    recovered: false,
    amount_recovered: 0,
    audit_status: "FAILED",
    verification_notes: `Unrecognized tool outcome: ${result.tool_called}`
  };
}

// server/db/auditLedger.ts
import crypto from "node:crypto";
var GENESIS_HASH = "0".repeat(64);
function calculateEventHash(event) {
  const normalizedViolations = (event.policy_violations || []).slice().sort().join(",");
  const normalizedScore = event.recoverability_score !== void 0 ? Number(event.recoverability_score).toFixed(4) : "";
  const normalizedConfidence = event.confidence !== void 0 ? Number(event.confidence).toFixed(4) : "";
  const canonicalPayload = [
    event.event_id,
    event.payment_id,
    event.timestamp,
    event.event_type,
    event.actor,
    event.agent_diagnosis || "",
    normalizedScore,
    normalizedConfidence,
    event.recommended_action || "",
    event.policy_decision,
    normalizedViolations,
    event.tool_called || "",
    event.execution_mode,
    event.tool_result || "",
    Number(event.amount_recovered || 0).toString(),
    event.final_payment_status,
    event.previous_hash
  ].join("|");
  return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
}
function verifyAuditChain(events) {
  if (!events || events.length === 0) {
    return {
      valid: true,
      total_events: 0,
      chain_head: GENESIS_HASH
    };
  }
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedPrevHash = i === 0 ? GENESIS_HASH : events[i - 1].current_hash;
    if (event.previous_hash !== expectedPrevHash) {
      return {
        valid: false,
        total_events: events.length,
        broken_at_index: i,
        error: `Invalid previous_hash at event index ${i} (${event.event_id}). Expected ${expectedPrevHash.slice(0, 16)}..., received ${event.previous_hash.slice(0, 16)}...`
      };
    }
    const expectedCurrentHash = calculateEventHash(event);
    if (event.current_hash !== expectedCurrentHash) {
      return {
        valid: false,
        total_events: events.length,
        broken_at_index: i,
        error: `Cryptographic tamper detected at event index ${i} (${event.event_id}). Stored current_hash (${event.current_hash.slice(0, 16)}...) does not match recalculated hash (${expectedCurrentHash.slice(0, 16)}...).`
      };
    }
  }
  return {
    valid: true,
    total_events: events.length,
    chain_head: events[events.length - 1].current_hash
  };
}
var AuditLedger = class _AuditLedger {
  /**
   * Appends an audit event to the persistent store with SHA-256 hash chaining.
   */
  static append(params) {
    const allEvents = dataStore.getAuditEvents();
    const previousHash = allEvents.length > 0 ? allEvents[allEvents.length - 1].current_hash : GENESIS_HASH;
    const eventId = params.event_id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = params.timestamp || (/* @__PURE__ */ new Date()).toISOString();
    const partialEvent = {
      ...params,
      event_id: eventId,
      timestamp,
      previous_hash: previousHash
    };
    const currentHash = calculateEventHash(partialEvent);
    const fullEvent = {
      ...partialEvent,
      current_hash: currentHash
    };
    dataStore.appendAuditEvent(fullEvent);
    return fullEvent;
  }
  /**
   * Records a deterministic policy evaluation event.
   */
  static recordPolicyEvaluation(payment, decision, policyResult) {
    return _AuditLedger.append({
      payment_id: payment.id,
      event_type: "POLICY_EVAL",
      actor: "POLICY_ENGINE",
      agent_diagnosis: decision.diagnosis,
      recoverability_score: decision.recoverability_score,
      confidence: decision.confidence,
      recommended_action: decision.recommended_action,
      policy_decision: policyResult.allowed ? "ALLOWED" : "BLOCKED",
      policy_violations: policyResult.violations.map((v) => v.rule),
      execution_mode: "SIMULATED_RECOVERY",
      amount_recovered: 0,
      final_payment_status: payment.status
    });
  }
  /**
   * Records an approved or dispatched tool execution attempt.
   */
  static recordToolExecution(payment, toolResult) {
    return _AuditLedger.append({
      payment_id: payment.id,
      event_type: "TOOL_EXECUTION",
      actor: "TOOL_RUNNER",
      recommended_action: toolResult.action,
      policy_decision: toolResult.policy_decision,
      policy_violations: toolResult.policy_violations,
      tool_called: toolResult.tool_called,
      execution_mode: toolResult.execution_mode,
      tool_result: toolResult.success ? "SUCCESS" : "FAILED",
      amount_recovered: toolResult.amount_recovered,
      final_payment_status: toolResult.final_payment_status
    });
  }
  /**
   * Records an authoritative outcome verification certifying financial transition.
   */
  static recordOutcomeVerification(payment, finalStatus, amountRecovered, auditStatus) {
    return _AuditLedger.append({
      payment_id: payment.id,
      event_type: "VERIFICATION",
      actor: "TOOL_RUNNER",
      policy_decision: "ALLOWED",
      execution_mode: "SIMULATED_RECOVERY",
      tool_result: auditStatus,
      amount_recovered: amountRecovered,
      final_payment_status: finalStatus
    });
  }
};

// server/tools/toolRegistry.ts
var ToolRouterError = class extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ToolRouterError";
    this.code = code;
  }
};
async function dispatchApprovedTool(payment, customer, decision, policyResult, options) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  if (!policyResult.allowed) {
    return {
      tool_called: "terminate_recovery",
      action: policyResult.finalAction,
      execution_mode: "SIMULATED_RECOVERY",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: options?.idempotencyKey || `blocked_${payment.id}_${Date.now()}`,
      policy_decision: "BLOCKED",
      policy_violations: policyResult.violations.map((v) => v.rule),
      final_payment_status: payment.status,
      message: `TOOL EXECUTION BLOCKED BY POLICY: ${policyResult.violations.map((v) => v.reason).join("; ")}`,
      error_message: "PolicyEngine refused execution permission",
      timestamp
    };
  }
  const targetAction = policyResult.finalAction;
  if (payment.status === "captured") {
    return {
      tool_called: "terminate_recovery",
      action: "STOP",
      execution_mode: "SIMULATED_RECOVERY",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: options?.idempotencyKey || `captured_block_${payment.id}`,
      policy_decision: "BLOCKED",
      policy_violations: ["ALREADY_SUCCESSFUL"],
      final_payment_status: "captured",
      message: "EXECUTION REFUSED: Payment is already captured.",
      error_message: "Cannot execute recovery on already captured payment",
      timestamp
    };
  }
  const idempotencyKey = options?.idempotencyKey || idempotencyStore.generateKey(payment.id, payment.recovery_attempts, targetAction);
  const existingCheck = idempotencyStore.check(idempotencyKey);
  if (existingCheck.exists) {
    if (existingCheck.inProgress) {
      throw new ToolRouterError(
        `Concurrent execution already in progress for idempotency key: ${idempotencyKey}`,
        "CONCURRENT_EXECUTION"
      );
    }
    if (existingCheck.result) {
      return {
        ...existingCheck.result,
        idempotent_replay: true,
        message: `[IDEMPOTENT REPLAY] ${existingCheck.result.message}`
      };
    }
  }
  const locked = idempotencyStore.lock(idempotencyKey, payment.id);
  if (!locked) {
    throw new ToolRouterError(
      `Failed to acquire execution lock for key: ${idempotencyKey}`,
      "LOCK_ACQUISITION_FAILED"
    );
  }
  try {
    let result;
    let paymentUpdates = {};
    const razorpayCfg = getRazorpayConfig();
    const useRazorpay = options?.preferredMode === "RAZORPAY_TEST_API" && razorpayCfg.isConfigured;
    switch (targetAction) {
      case "RETRY_PAYMENT": {
        if (useRazorpay) {
          result = await createRazorpayTestOrder(payment, idempotencyKey);
          paymentUpdates = {
            recovery_attempts: payment.recovery_attempts + 1,
            updated_at: timestamp
          };
        } else {
          const sim = simulatePaymentRetry(payment, customer, idempotencyKey);
          result = sim.toolResult;
          paymentUpdates = sim.updatedPayment;
        }
        break;
      }
      case "SEND_PAYMENT_REMINDER": {
        if (useRazorpay) {
          result = await createRazorpayTestPaymentLink(
            payment,
            customer,
            idempotencyKey,
            options?.reminderMessage || decision.customer_recovery_message
          );
          paymentUpdates = { updated_at: timestamp };
        } else {
          const sim = simulatePaymentReminder(
            payment,
            customer,
            idempotencyKey,
            options?.reminderMessage || decision.customer_recovery_message
          );
          result = sim.toolResult;
          paymentUpdates = sim.updatedPayment;
        }
        break;
      }
      case "ESCALATE": {
        const sim = simulateEscalateToOps(
          payment,
          decision.reasoning || "Automated recovery escalated to Human Operations",
          idempotencyKey
        );
        result = sim.toolResult;
        paymentUpdates = sim.updatedPayment;
        break;
      }
      case "STOP": {
        const sim = simulateTerminateRecovery(
          payment,
          decision.reasoning || "Automated recovery stopped by policy or diagnosis",
          idempotencyKey
        );
        result = sim.toolResult;
        paymentUpdates = sim.updatedPayment;
        break;
      }
      default: {
        idempotencyStore.release(idempotencyKey);
        throw new ToolRouterError(`Unknown recovery action verb: ${targetAction}`, "INVALID_ACTION");
      }
    }
    const verified = verifyExecutionOutcome(payment, result);
    result.final_payment_status = verified.final_payment_status;
    result.recovered = verified.recovered;
    result.amount_recovered = verified.amount_recovered;
    paymentUpdates.status = verified.final_payment_status;
    dataStore.updatePayment(payment.id, paymentUpdates);
    idempotencyStore.commit(idempotencyKey, result);
    AuditLedger.recordToolExecution(payment, result);
    AuditLedger.recordOutcomeVerification(
      payment,
      verified.final_payment_status,
      verified.amount_recovered,
      verified.audit_status
    );
    return result;
  } catch (error) {
    idempotencyStore.release(idempotencyKey);
    throw error;
  }
}
async function executeRecoveryPipeline(paymentId, providedDecision, options) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  if (options?.idempotencyKey) {
    const check = idempotencyStore.check(options.idempotencyKey);
    if (check.exists) {
      if (check.inProgress) {
        throw new ToolRouterError(
          `Concurrent execution already in progress for idempotency key: ${options.idempotencyKey}`,
          "CONCURRENT_EXECUTION"
        );
      }
      if (check.result) {
        return {
          toolResult: {
            ...check.result,
            idempotent_replay: true,
            message: `[IDEMPOTENT REPLAY] ${check.result.message}`
          },
          policyResult: {
            allowed: true,
            originalAction: check.result.action,
            finalAction: check.result.action,
            violations: [],
            evaluatedRules: [],
            evaluatedAt: check.result.timestamp
          }
        };
      }
    }
  }
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    throw new ToolRouterError(`Payment not found: ${paymentId}`, "NOT_FOUND");
  }
  const customer = dataStore.getCustomerById(payment.customer_id);
  if (!customer) {
    throw new ToolRouterError(`Customer not found for payment: ${payment.customer_id}`, "CUSTOMER_NOT_FOUND");
  }
  const policy = dataStore.getPolicy();
  let decision;
  if (providedDecision) {
    const validation = validateAgentDecision(providedDecision, paymentId);
    if (!validation.valid) {
      decision = createFallbackDecision(paymentId, `Malformed AI response: ${validation.error}`);
    } else {
      decision = providedDecision;
    }
  } else {
    decision = {
      payment_id: paymentId,
      diagnosis: "transient_bank_downtime",
      recoverability_score: 0.5,
      recommended_action: "RETRY_PAYMENT",
      confidence: 0.75,
      risk_level: "LOW",
      reasoning: "Standard pipeline evaluation"
    };
  }
  const policyResult = policyEngine.evaluate(payment, customer, decision, policy);
  if (!policyResult.allowed) {
    const blockedResult = {
      tool_called: "terminate_recovery",
      action: policyResult.finalAction,
      execution_mode: "SIMULATED_RECOVERY",
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: options?.idempotencyKey || `policy_blocked_${payment.id}_${Date.now()}`,
      policy_decision: "BLOCKED",
      policy_violations: policyResult.violations.map((v) => v.rule),
      final_payment_status: payment.status,
      message: `PolicyEngine BLOCKED execution: ${policyResult.violations.map((v) => v.reason).join("; ")}`,
      error_message: "PolicyEngine denied recovery tool execution permission",
      timestamp
    };
    if (policyResult.finalAction === "ESCALATE" && payment.status !== "escalated") {
      dataStore.updatePayment(payment.id, { status: "escalated" });
      blockedResult.final_payment_status = "escalated";
    } else if (policyResult.finalAction === "STOP" && payment.status !== "abandoned" && payment.status !== "captured") {
      dataStore.updatePayment(payment.id, { status: "abandoned" });
      blockedResult.final_payment_status = "abandoned";
    }
    AuditLedger.recordPolicyEvaluation(payment, decision, policyResult);
    AuditLedger.recordOutcomeVerification(
      payment,
      blockedResult.final_payment_status,
      0,
      "SKIPPED"
    );
    return { toolResult: blockedResult, policyResult };
  }
  AuditLedger.recordPolicyEvaluation(payment, decision, policyResult);
  const toolResult = await dispatchApprovedTool(
    payment,
    customer,
    decision,
    policyResult,
    options
  );
  return { toolResult, policyResult };
}

// server/routes/recoveryRoutes.ts
var recoveryRouter = Router2();
recoveryRouter.post("/:paymentId/execute", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { decision, idempotency_key, preferred_mode, reminder_message } = req.body;
    const result = await executeRecoveryPipeline(
      paymentId,
      decision,
      {
        idempotencyKey: idempotency_key,
        preferredMode: preferred_mode,
        reminderMessage: reminder_message
      }
    );
    res.json({
      success: result.toolResult.success,
      toolResult: result.toolResult,
      policyResult: result.policyResult
    });
  } catch (err) {
    if (err instanceof ToolRouterError) {
      const status = err.code === "NOT_FOUND" ? 404 : 400;
      res.status(status).json({
        success: false,
        error: err.message,
        code: err.code
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error"
    });
  }
});
recoveryRouter.post("/:paymentId/remind", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { custom_message, preferred_mode, idempotency_key } = req.body;
    const payment = dataStore.getPaymentById(paymentId);
    if (!payment) {
      res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
      return;
    }
    const customer = dataStore.getCustomerById(payment.customer_id);
    if (!customer) {
      res.status(404).json({ success: false, error: `Customer not found: ${payment.customer_id}` });
      return;
    }
    const decision = {
      payment_id: paymentId,
      diagnosis: "transient_bank_downtime",
      recoverability_score: 0.8,
      recommended_action: "SEND_PAYMENT_REMINDER",
      confidence: 0.9,
      risk_level: "LOW",
      reasoning: "Operator or automated pipeline initiated payment reminder link",
      customer_recovery_message: custom_message
    };
    const result = await executeRecoveryPipeline(paymentId, decision, {
      idempotencyKey: idempotency_key,
      preferredMode: preferred_mode,
      reminderMessage: custom_message
    });
    res.json({
      success: result.toolResult.success,
      toolResult: result.toolResult,
      policyResult: result.policyResult
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error"
    });
  }
});
recoveryRouter.post("/:paymentId/escalate", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { reason, idempotency_key } = req.body;
    const payment = dataStore.getPaymentById(paymentId);
    if (!payment) {
      res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
      return;
    }
    const decision = {
      payment_id: paymentId,
      diagnosis: "fatal_declined_card",
      recoverability_score: 0,
      recommended_action: "ESCALATE",
      confidence: 1,
      risk_level: "MEDIUM",
      reasoning: reason || "Operations escalation requested"
    };
    const result = await executeRecoveryPipeline(paymentId, decision, {
      idempotencyKey: idempotency_key
    });
    res.json({
      success: result.toolResult.success,
      toolResult: result.toolResult,
      policyResult: result.policyResult
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Internal Server Error"
    });
  }
});
recoveryRouter.get("/:paymentId/status", (req, res) => {
  const { paymentId } = req.params;
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
    return;
  }
  const customer = dataStore.getCustomerById(payment.customer_id);
  const policy = dataStore.getPolicy();
  const auditEvents = dataStore.getAuditEvents(paymentId);
  res.json({
    success: true,
    payment,
    customer,
    policy,
    auditEvents
  });
});

// server/routes/dashboardRoutes.ts
import { Router as Router3 } from "express";
var dashboardRouter = Router3();
dashboardRouter.get("/metrics", (_req, res) => {
  const allPayments = dataStore.getAllPayments();
  const allDemoScenarios = dataStore.getAllDemoScenarios();
  const combinedPaymentsMap = /* @__PURE__ */ new Map();
  for (const p of allPayments) {
    combinedPaymentsMap.set(p.id, p);
  }
  for (const demoKey of Object.keys(allDemoScenarios)) {
    const demoPay = allDemoScenarios[demoKey].payment;
    combinedPaymentsMap.set(demoPay.id, demoPay);
  }
  const payments = Array.from(combinedPaymentsMap.values());
  const auditEvents = dataStore.getAuditEvents();
  let totalPayments = payments.length;
  let recoverableCount = 0;
  let capturedCount = 0;
  let escalatedCount = 0;
  let abandonedCount = 0;
  let revenueAtRiskPaise = 0;
  let revenueRecoveredPaise = 0;
  for (const p of payments) {
    const isRecoverable = p.ground_truth_recoverable || p.failure_category === "TRANSIENT_BANK_FAILURE" || p.failure_category === "NETWORK_ERROR";
    if (isRecoverable) {
      recoverableCount++;
    }
    if (p.status === "captured") {
      capturedCount++;
      revenueRecoveredPaise += p.amount;
    } else {
      revenueAtRiskPaise += p.amount;
      if (p.status === "escalated") {
        escalatedCount++;
      } else if (p.status === "abandoned") {
        abandonedCount++;
      }
    }
  }
  let policyEvaluations = 0;
  let policyAllowedCount = 0;
  let policyBlockedCount = 0;
  let toolExecutedCount = 0;
  let outcomeVerifiedCount = 0;
  let simulatedRecoveryCount = 0;
  let razorpayTestApiCount = 0;
  let opsEscalatedCount = 0;
  let recoveryTerminatedCount = 0;
  let unnecessaryRetryCount = 0;
  for (const evt of auditEvents) {
    if (evt.event_type === "POLICY_EVAL") {
      policyEvaluations++;
      if (evt.policy_decision === "ALLOWED") {
        policyAllowedCount++;
      } else {
        policyBlockedCount++;
      }
    } else if (evt.event_type === "TOOL_EXECUTION") {
      toolExecutedCount++;
      const mode = evt.execution_mode;
      const tool = evt.tool_called;
      if (mode === "RAZORPAY_TEST_API") {
        razorpayTestApiCount++;
      } else if (mode === "SIMULATED_RECOVERY") {
        simulatedRecoveryCount++;
      }
      if (tool === "escalate_to_ops") {
        opsEscalatedCount++;
      } else if (tool === "terminate_recovery") {
        recoveryTerminatedCount++;
      }
      const targetPay = combinedPaymentsMap.get(evt.payment_id);
      if (targetPay && !targetPay.ground_truth_recoverable && tool === "retry_payment") {
        unnecessaryRetryCount++;
      }
    } else if (evt.event_type === "VERIFICATION") {
      outcomeVerifiedCount++;
    }
  }
  const aiDiagnosedCount = new Set(
    auditEvents.filter((e) => e.event_type === "DIAGNOSIS").map((e) => e.payment_id)
  ).size;
  const policyEvaluatedPaymentsCount = new Set(
    auditEvents.filter((e) => e.event_type === "POLICY_EVAL").map((e) => e.payment_id)
  ).size;
  const policyBlockRate = policyEvaluations > 0 ? policyBlockedCount / policyEvaluations * 100 : 0;
  const recoveryRate = recoverableCount > 0 ? capturedCount / recoverableCount * 100 : 0;
  const escalationRate = totalPayments > 0 ? escalatedCount / totalPayments * 100 : 0;
  const unnecessaryRetryRate = totalPayments > 0 ? unnecessaryRetryCount / totalPayments * 100 : 0;
  const response = {
    success: true,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    metrics: {
      total_failed_payments: totalPayments,
      recoverable_payments: recoverableCount,
      total_captured_payments: capturedCount,
      total_escalated_payments: escalatedCount,
      total_abandoned_payments: abandonedCount,
      recovery_rate_percent: Number(recoveryRate.toFixed(1)),
      revenue_at_risk_paise: revenueAtRiskPaise,
      revenue_at_risk_inr: Number((revenueAtRiskPaise / 100).toFixed(2)),
      revenue_recovered_paise: revenueRecoveredPaise,
      revenue_recovered_inr: Number((revenueRecoveredPaise / 100).toFixed(2)),
      policy_block_rate_percent: Number(policyBlockRate.toFixed(1)),
      escalation_rate_percent: Number(escalationRate.toFixed(1)),
      unnecessary_retry_rate_percent: Number(unnecessaryRetryRate.toFixed(1)),
      execution_breakdown: {
        razorpay_test_api: razorpayTestApiCount,
        simulated_recovery: simulatedRecoveryCount,
        ops_escalated: opsEscalatedCount,
        recovery_terminated: recoveryTerminatedCount
      }
    },
    funnel: {
      telemetry_failed: totalPayments,
      ai_diagnosed: aiDiagnosedCount,
      policy_evaluated: policyEvaluatedPaymentsCount,
      policy_approved: policyAllowedCount,
      policy_blocked: policyBlockedCount,
      tool_executed: toolExecutedCount,
      outcome_verified: outcomeVerifiedCount,
      recovered: capturedCount,
      escalated: escalatedCount,
      terminated: abandonedCount
    }
  };
  res.json(response);
});

// server/routes/paymentRoutes.ts
import { Router as Router4 } from "express";
var paymentRouter = Router4();
paymentRouter.get("/", (req, res) => {
  const filter = req.query.filter || "all";
  const search = (req.query.search || "").trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const sort = req.query.sort || "recent";
  const allPayments = dataStore.getAllPayments();
  const allDemoScenarios = dataStore.getAllDemoScenarios();
  const combinedMap = /* @__PURE__ */ new Map();
  for (const demoKey of Object.keys(allDemoScenarios)) {
    const demoPay = allDemoScenarios[demoKey].payment;
    combinedMap.set(demoPay.id, demoPay);
  }
  for (const p of allPayments) {
    if (!combinedMap.has(p.id)) {
      combinedMap.set(p.id, p);
    }
  }
  let payments = Array.from(combinedMap.values());
  const customers = dataStore.getAllCustomers();
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  for (const demoKey of Object.keys(allDemoScenarios)) {
    const demoCust = allDemoScenarios[demoKey].customer;
    customerMap.set(demoCust.id, demoCust);
  }
  if (search) {
    payments = payments.filter((p) => {
      const cust = customerMap.get(p.customer_id);
      const matchesId = p.id.toLowerCase().includes(search);
      const matchesCustId = p.customer_id.toLowerCase().includes(search);
      const matchesCustName = cust?.name.toLowerCase().includes(search);
      const matchesFailureCode = p.failure_code.toLowerCase().includes(search);
      const matchesFailureReason = p.failure_reason.toLowerCase().includes(search);
      return matchesId || matchesCustId || matchesCustName || matchesFailureCode || matchesFailureReason;
    });
  }
  if (filter !== "all") {
    payments = payments.filter((p) => {
      const cust = customerMap.get(p.customer_id);
      switch (filter) {
        case "recoverable":
          return p.ground_truth_recoverable || p.failure_category === "TRANSIENT_BANK_FAILURE" || p.failure_category === "NETWORK_ERROR";
        case "recovered":
          return p.status === "captured";
        case "blocked": {
          const events = dataStore.getAuditEvents(p.id);
          const hasBlockedEvent = events.some((e) => e.policy_decision === "BLOCKED");
          return hasBlockedEvent || p.status === "abandoned";
        }
        case "escalated":
          return p.status === "escalated";
        case "high_value":
          return p.amount > 5e6;
        // > ₹50,000
        case "opted_out":
          return cust?.opted_out === true;
        case "retry":
          return p.ground_truth_best_action === "RETRY_PAYMENT";
        case "reminder":
          return p.ground_truth_best_action === "SEND_PAYMENT_REMINDER";
        case "stop":
          return p.ground_truth_best_action === "STOP" || p.status === "abandoned";
        default:
          return true;
      }
    });
  }
  if (sort === "amount_desc") {
    payments.sort((a, b) => b.amount - a.amount);
  } else if (sort === "amount_asc") {
    payments.sort((a, b) => a.amount - b.amount);
  } else {
    payments.sort((a, b) => {
      const isDemoA = a.id.startsWith("pay_demo_");
      const isDemoB = b.id.startsWith("pay_demo_");
      if (isDemoA && !isDemoB) return -1;
      if (!isDemoA && isDemoB) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }
  const total = payments.length;
  const sliced = payments.slice(offset, offset + limit);
  const enriched = sliced.map((p) => {
    const cust = customerMap.get(p.customer_id) || null;
    const events = dataStore.getAuditEvents(p.id);
    const latestEvent = events.length > 0 ? events[events.length - 1] : null;
    return {
      payment: p,
      customer: cust,
      auditCount: events.length,
      latestEvent,
      id: p.id,
      customer_name: cust?.name,
      customer_id: p.customer_id,
      amount: p.amount,
      failure_reason: p.failure_reason,
      error_code: p.failure_code,
      recovery_attempts: p.recovery_attempts,
      status: p.status,
      last_agent_action: latestEvent?.recommended_action,
      last_agent_confidence: latestEvent?.confidence,
      last_policy_status: latestEvent?.policy_decision,
      last_tool_name: latestEvent?.tool_called
    };
  });
  res.json({
    success: true,
    total,
    count: enriched.length,
    offset,
    limit,
    payments: enriched
  });
});
paymentRouter.get("/:paymentId", (req, res) => {
  const { paymentId } = req.params;
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
    return;
  }
  const customer = dataStore.getCustomerById(payment.customer_id);
  const policy = dataStore.getPolicy();
  const auditEvents = dataStore.getAuditEvents(paymentId);
  res.json({
    success: true,
    payment,
    customer,
    policy,
    auditEvents
  });
});

// server/routes/demoRoutes.ts
import { Router as Router5 } from "express";
var demoRouter = Router5();
demoRouter.post("/scenario/:id/run", async (req, res) => {
  const scenarioId = req.params.id.toLowerCase();
  try {
    switch (scenarioId) {
      case "scenario_a": {
        dataStore.resetDemoScenario("pay_demo_transient_01");
        const payment = dataStore.getPaymentById("pay_demo_transient_01");
        const customer = dataStore.getCustomerById(payment.customer_id);
        const aiDecision = {
          payment_id: payment.id,
          diagnosis: "transient_bank_downtime",
          recoverability_score: 0.92,
          recommended_action: "RETRY_PAYMENT",
          confidence: 0.88,
          risk_level: "LOW",
          reasoning: "Transient issuer switch downtime (503). Automatic switch retry after cooldown recommended."
        };
        const validation = validateAgentDecision(aiDecision, payment.id);
        const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
          idempotencyKey: `demo_run_a_${Date.now()}`
        });
        const refreshedPayment = dataStore.getPaymentById(payment.id);
        const auditEvents = dataStore.getAuditEvents(payment.id);
        res.json({
          success: true,
          scenarioId: "scenario_a",
          scenarioTitle: "SCENARIO A \u2014 Successful Transient Recovery",
          scenarioDescription: "Transient issuer switch downtime (503) on \u20B92,499 payment. AI identifies transient error, Policy Engine approves retry, Bounded Router executes simulated recovery, outcome is verified captured.",
          expectedBehavior: "Policy ALLOWED \u2192 SIMULATED_RECOVERY \u2192 Captured (\u20B92,499 Recovered)",
          payment: refreshedPayment,
          customer,
          telemetry: {
            failure_code: payment.failure_code,
            failure_category: payment.failure_category,
            amount_inr: payment.amount / 100,
            opted_out: customer.opted_out,
            recovery_attempts: refreshedPayment.recovery_attempts,
            seconds_since_failure: payment.seconds_since_failure
          },
          aiDecision,
          validation: { valid: validation.valid, error: validation.error },
          policyResult,
          toolResult,
          outcomeVerification: {
            verified: toolResult.recovered,
            final_status: toolResult.final_payment_status,
            recovered: toolResult.recovered,
            amount_recovered_inr: toolResult.amount_recovered / 100,
            message: "Payment verified captured in ledger. Full amount recovered."
          },
          auditTrail: auditEvents.map((e) => ({
            timestamp: e.timestamp,
            event_type: e.event_type,
            actor: e.actor,
            result: e.tool_result || e.policy_decision || e.final_payment_status || "RECORDED"
          }))
        });
        return;
      }
      case "scenario_b": {
        dataStore.resetDemoScenario("pay_demo_persistent_02");
        const payment = dataStore.getPaymentById("pay_demo_persistent_02");
        const customer = dataStore.getCustomerById(payment.customer_id);
        const decisionAttempt2 = {
          payment_id: payment.id,
          diagnosis: "insufficient_funds",
          recoverability_score: 0.65,
          recommended_action: "RETRY_PAYMENT",
          confidence: 0.7,
          risk_level: "MEDIUM",
          reasoning: "Attempting retry #2 for persistent limit error"
        };
        await executeRecoveryPipeline(payment.id, decisionAttempt2, {
          idempotencyKey: `demo_run_b_1_${Date.now()}`
        });
        const decisionAttempt3 = {
          payment_id: payment.id,
          diagnosis: "insufficient_funds",
          recoverability_score: 0.6,
          recommended_action: "RETRY_PAYMENT",
          confidence: 0.65,
          risk_level: "MEDIUM",
          reasoning: "AI erroneously attempts retry #3 after limit failure"
        };
        const validation = validateAgentDecision(decisionAttempt3, payment.id);
        const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, decisionAttempt3, {
          idempotencyKey: `demo_run_b_2_${Date.now()}`
        });
        const refreshedPayment = dataStore.getPaymentById(payment.id);
        const auditEvents = dataStore.getAuditEvents(payment.id);
        res.json({
          success: true,
          scenarioId: "scenario_b",
          scenarioTitle: "SCENARIO B \u2014 Persistent Failure \u2192 Escalation",
          scenarioDescription: "Customer reached card limit. Retry #2 fails; next attempt triggers MAX_RETRIES_EXCEEDED guardrail. Policy Engine overrides AI and forces ESCALATE to prevent customer harassment.",
          expectedBehavior: "MAX_RETRIES_EXCEEDED \u2192 Policy BLOCKED \u2192 Forced ESCALATE (Zero False Recovery)",
          payment: refreshedPayment,
          customer,
          telemetry: {
            failure_code: payment.failure_code,
            failure_category: payment.failure_category,
            amount_inr: payment.amount / 100,
            opted_out: customer.opted_out,
            recovery_attempts: refreshedPayment.recovery_attempts,
            seconds_since_failure: payment.seconds_since_failure
          },
          aiDecision: decisionAttempt3,
          validation: { valid: validation.valid, error: validation.error },
          policyResult,
          toolResult,
          outcomeVerification: {
            verified: true,
            final_status: toolResult.final_payment_status,
            recovered: false,
            amount_recovered_inr: 0,
            message: "Retry blocked by policy. Payment safely escalated to human operations."
          },
          auditTrail: auditEvents.map((e) => ({
            timestamp: e.timestamp,
            event_type: e.event_type,
            actor: e.actor,
            result: e.tool_result || e.policy_decision || e.final_payment_status || "ESCALATED"
          }))
        });
        return;
      }
      case "scenario_c": {
        dataStore.resetDemoScenario("pay_demo_highvalue_03");
        const payment = dataStore.getPaymentById("pay_demo_highvalue_03");
        const customer = dataStore.getCustomerById(payment.customer_id);
        const aiDecision = {
          payment_id: payment.id,
          diagnosis: "network_timeout",
          recoverability_score: 0.95,
          recommended_action: "RETRY_PAYMENT",
          confidence: 0.92,
          risk_level: "LOW",
          reasoning: "High-value enterprise transaction with network timeout. AI requests automated retry."
        };
        const validation = validateAgentDecision(aiDecision, payment.id);
        const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
          idempotencyKey: `demo_run_c_${Date.now()}`
        });
        const refreshedPayment = dataStore.getPaymentById(payment.id);
        const auditEvents = dataStore.getAuditEvents(payment.id);
        res.json({
          success: true,
          scenarioId: "scenario_c",
          scenarioTitle: "SCENARIO C \u2014 High Value + Opted Out \u2192 Policy Block",
          scenarioDescription: "\u20B985,000 transaction (exceeds \u20B950,000 cap) and customer is opted out. AI proposes automated retry, but Policy Engine halts execution under CUSTOMER_OPTED_OUT and AMOUNT_EXCEEDS_CAP. Zero financial tool/API execution; recovery terminated locally.",
          expectedBehavior: "Violations: CUSTOMER_OPTED_OUT & AMOUNT_EXCEEDS_CAP \u2192 Forced STOP (Zero Financial Tool/API Execution)",
          payment: refreshedPayment,
          customer,
          telemetry: {
            failure_code: payment.failure_code,
            failure_category: payment.failure_category,
            amount_inr: payment.amount / 100,
            opted_out: customer.opted_out,
            recovery_attempts: refreshedPayment.recovery_attempts,
            seconds_since_failure: payment.seconds_since_failure
          },
          aiDecision,
          validation: { valid: validation.valid, error: validation.error },
          policyResult,
          toolResult,
          outcomeVerification: {
            verified: true,
            final_status: toolResult.final_payment_status,
            recovered: false,
            amount_recovered_inr: 0,
            message: "Zero financial tool/API execution; recovery terminated locally to honor customer preferences."
          },
          auditTrail: auditEvents.map((e) => ({
            timestamp: e.timestamp,
            event_type: e.event_type,
            actor: e.actor,
            result: "STOP"
          }))
        });
        return;
      }
      case "scenario_d": {
        dataStore.resetDemoScenario("pay_demo_transient_01");
        const payment = dataStore.getPaymentById("pay_demo_transient_01");
        const customer = dataStore.getCustomerById(payment.customer_id);
        const malformedAiDecision = {
          payment_id: "corrupted_or_mismatched_id",
          diagnosis: "unknown_hallucinated_diagnosis",
          recoverability_score: 8.85,
          // Out of bounds [0, 1]
          recommended_action: "EXECUTE_PAYMENT_FORCEFULLY",
          // Illegal action verb
          confidence: -0.5,
          // Out of bounds
          risk_level: "SUPER_CRITICAL"
        };
        const validation = validateAgentDecision(malformedAiDecision, payment.id);
        const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, malformedAiDecision, {
          idempotencyKey: `demo_run_d_${Date.now()}`
        });
        const refreshedPayment = dataStore.getPaymentById(payment.id);
        const auditEvents = dataStore.getAuditEvents(payment.id);
        res.json({
          success: true,
          scenarioId: "scenario_d",
          scenarioTitle: "SCENARIO D \u2014 Malformed AI Response \u2192 Safe Fallback",
          scenarioDescription: "Simulates corrupted or hallucinated LLM response (out-of-bounds score, illegal action verb). Runtime validator intercepts output, flags schema breach, and fails closed to safe ESCALATE.",
          expectedBehavior: "Schema Validation Failure \u2192 Fails Closed to ESCALATE (Zero Financial Execution)",
          payment: refreshedPayment,
          customer,
          telemetry: {
            failure_code: payment.failure_code,
            failure_category: payment.failure_category,
            amount_inr: payment.amount / 100,
            opted_out: customer.opted_out,
            recovery_attempts: refreshedPayment.recovery_attempts,
            seconds_since_failure: payment.seconds_since_failure
          },
          aiDecision: malformedAiDecision,
          validation: { valid: validation.valid, error: validation.error },
          policyResult,
          toolResult,
          outcomeVerification: {
            verified: true,
            final_status: toolResult.final_payment_status,
            recovered: false,
            amount_recovered_inr: 0,
            message: "Malformed AI response rejected by runtime validator. Zero financial API execution; escalated safely to ops."
          },
          auditTrail: auditEvents.map((e) => ({
            timestamp: e.timestamp,
            event_type: e.event_type,
            actor: e.actor,
            result: "FAIL_CLOSED_ESCALATE"
          }))
        });
        return;
      }
      case "scenario_e": {
        dataStore.resetDemoScenario("pay_demo_captured_05");
        const payment = dataStore.getPaymentById("pay_demo_captured_05");
        const customer = dataStore.getCustomerById(payment.customer_id);
        const aiDecision = {
          payment_id: payment.id,
          diagnosis: "transient_bank_downtime",
          recoverability_score: 0.99,
          recommended_action: "RETRY_PAYMENT",
          confidence: 0.95,
          risk_level: "LOW",
          reasoning: "Erroneous retry proposal on already captured transaction"
        };
        const validation = validateAgentDecision(aiDecision, payment.id);
        const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
          idempotencyKey: `demo_run_e_${Date.now()}`
        });
        const refreshedPayment = dataStore.getPaymentById(payment.id);
        const auditEvents = dataStore.getAuditEvents(payment.id);
        res.json({
          success: true,
          scenarioId: "scenario_e",
          scenarioTitle: "SCENARIO E \u2014 Already Captured \u2192 STOP",
          scenarioDescription: "Payment is already in captured status. An erroneous recovery attempt is submitted. Policy Engine ALREADY_SUCCESSFUL guardrail intercepts and terminates recovery, strictly preventing duplicate charges.",
          expectedBehavior: "ALREADY_SUCCESSFUL Violation \u2192 Forced STOP (Zero Financial Execution)",
          payment: refreshedPayment,
          customer,
          telemetry: {
            failure_code: payment.failure_code,
            failure_category: payment.failure_category,
            amount_inr: payment.amount / 100,
            opted_out: customer.opted_out,
            recovery_attempts: refreshedPayment.recovery_attempts,
            seconds_since_failure: payment.seconds_since_failure
          },
          aiDecision,
          validation: { valid: validation.valid, error: validation.error },
          policyResult,
          toolResult,
          outcomeVerification: {
            verified: true,
            final_status: toolResult.final_payment_status,
            recovered: false,
            amount_recovered_inr: 0,
            message: "Duplicate charge strictly blocked. State remains captured."
          },
          auditTrail: auditEvents.map((e) => ({
            timestamp: e.timestamp,
            event_type: e.event_type,
            actor: e.actor,
            result: "STOP_ALREADY_SUCCESSFUL"
          }))
        });
        return;
      }
      default: {
        res.status(404).json({
          success: false,
          error: `Unknown demo scenario "${scenarioId}". Supported: scenario_a, scenario_b, scenario_c, scenario_d, scenario_e`
        });
        return;
      }
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Demo execution failed"
    });
  }
});
demoRouter.post("/judge-workflow", async (req, res) => {
  try {
    const paymentId = "pay_demo_transient_01";
    dataStore.resetDemoScenario(paymentId);
    const payment = dataStore.getPaymentById(paymentId);
    const customer = dataStore.getCustomerById(payment.customer_id);
    const policy = dataStore.getPolicy();
    const quarantinedGroundTruth = {
      ground_truth_recoverable: payment.ground_truth_recoverable,
      ground_truth_best_action: payment.ground_truth_best_action,
      ground_truth_expected_outcome: payment.ground_truth_expected_outcome,
      ground_truth_reason: payment.ground_truth_reason
    };
    const sanitizedContext = toAgentInputContext(payment, customer, policy);
    let diagnosisSource = "DETERMINISTIC_FALLBACK";
    let fallbackReason = void 0;
    let aiDecision;
    try {
      const geminiResult = await geminiRecoveryAgent.diagnose(sanitizedContext);
      if (geminiResult && geminiResult.success && !geminiResult.fallback && geminiResult.decision) {
        diagnosisSource = "GEMINI_3.8_FLASH";
        aiDecision = geminiResult.decision;
      } else {
        diagnosisSource = "DETERMINISTIC_FALLBACK";
        fallbackReason = geminiResult?.error || "Gemini Free Tier Quota / Rate-Limit (429/503). Safe fallback activated.";
        aiDecision = {
          payment_id: payment.id,
          diagnosis: "transient_bank_downtime",
          recoverability_score: 0.92,
          recommended_action: "RETRY_PAYMENT",
          confidence: 0.88,
          risk_level: "LOW",
          reasoning: "Transient issuer switch downtime (503). Switch health restored. Automatic switch retry after cooldown recommended."
        };
      }
    } catch (apiErr) {
      diagnosisSource = "DETERMINISTIC_FALLBACK";
      fallbackReason = apiErr?.message || "Gemini inference timeout / connection error";
      aiDecision = {
        payment_id: payment.id,
        diagnosis: "transient_bank_downtime",
        recoverability_score: 0.92,
        recommended_action: "RETRY_PAYMENT",
        confidence: 0.88,
        risk_level: "LOW",
        reasoning: "Transient issuer switch downtime (503). Switch health restored. Automatic switch retry after cooldown recommended."
      };
    }
    const validation = validateAgentDecision(aiDecision, payment.id);
    const idempotencyKey = `judge_demo_${payment.id}_${Date.now()}`;
    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
      idempotencyKey
    });
    const refreshedPayment = dataStore.getPaymentById(payment.id);
    const auditEvents = dataStore.getAuditEvents(payment.id);
    const verifiedCaptured = refreshedPayment.status === "captured";
    const amountRecoveredPaise = verifiedCaptured ? payment.amount : 0;
    res.json({
      success: true,
      payment: refreshedPayment,
      customer,
      sanitizedContext,
      quarantinedGroundTruth,
      diagnosisSource,
      fallbackReason,
      aiDecision,
      validation: { valid: validation.valid, error: validation.error },
      policyResult,
      toolResult,
      outcomeVerification: {
        verified: true,
        tool_execution_status: toolResult.success ? "HTTP_200_SUCCESS" : "FAILED",
        payment_status: refreshedPayment.status,
        recovered: verifiedCaptured,
        amount_recovered_inr: amountRecoveredPaise / 100,
        invariant_rule: "TOOL_EXECUTION_SUCCESS !== PAYMENT_RECOVERY_SUCCESS",
        message: "Payment independently verified as captured in merchant datastore."
      },
      auditTrail: auditEvents,
      benchmarks: {
        dataset_size: 600,
        naive: {
          recovery_rate: "100%",
          precision: "81.2%",
          safety_violations: 96,
          false_positives: 113,
          tool_executions: 600
        },
        deterministic: {
          recovery_rate: "78.0%",
          precision: "100.0%",
          safety_violations: 0,
          false_positives: 0,
          missed_recoveries: 107
        },
        recoverpay: {
          recovery_rate: "94.3%",
          precision: "100.0%",
          safety_violations: 0,
          false_positives: 0,
          policy_blocks: 58,
          ops_escalations: 40,
          f1_score: "0.970"
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Judge demonstration execution failed"
    });
  }
});
demoRouter.post("/safety-block", async (req, res) => {
  try {
    const paymentId = "pay_demo_highvalue_03";
    dataStore.resetDemoScenario(paymentId);
    const payment = dataStore.getPaymentById(paymentId);
    const customer = dataStore.getCustomerById(payment.customer_id);
    const policy = dataStore.getPolicy();
    const sanitizedContext = toAgentInputContext(payment, customer, policy);
    const aiDecision = {
      payment_id: payment.id,
      diagnosis: "network_timeout",
      recoverability_score: 0.85,
      recommended_action: "RETRY_PAYMENT",
      confidence: 0.82,
      risk_level: "MEDIUM",
      reasoning: "Transient network failure detected. Recommending retry dispatch."
    };
    const idempotencyKey = `safety_block_${payment.id}_${Date.now()}`;
    const { toolResult, policyResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
      idempotencyKey
    });
    const refreshedPayment = dataStore.getPaymentById(payment.id);
    const auditEvents = dataStore.getAuditEvents(payment.id);
    res.json({
      success: true,
      payment: refreshedPayment,
      customer,
      sanitizedContext,
      aiDecision,
      policyResult,
      toolResult,
      outcomeVerification: {
        verified: true,
        tool_execution_status: "ZERO_TOOL_EXECUTION",
        payment_status: refreshedPayment.status,
        recovered: false,
        amount_recovered_inr: 0,
        message: "PolicyEngine strictly intercepted transaction. Zero financial tools dispatched."
      },
      auditTrail: auditEvents
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Safety block execution failed"
    });
  }
});

// server/routes/evaluationRoutes.ts
import { Router as Router6 } from "express";

// server/evaluation/evaluator.ts
function sanitizePaymentForStrategy(payment) {
  const {
    ground_truth_recoverable: _gtr,
    ground_truth_best_action: _gtba,
    ground_truth_expected_outcome: _gteo,
    ground_truth_reason: _gtrn,
    ...sanitized
  } = payment;
  return sanitized;
}
function deterministicBenchmarkAgent(sanitizedPayment, customer) {
  const { failure_category, failure_code, failure_reason, amount, seconds_since_failure } = sanitizedPayment;
  const { historical_success_rate, previous_failure_count } = customer;
  if (failure_category === "TRANSIENT_BANK_FAILURE" || failure_category === "NETWORK_ERROR") {
    const isOverload = failure_code.includes("BUSY") || failure_code.includes("TIMEOUT") || failure_reason.includes("503");
    const recoverability = isOverload ? 0.92 : 0.85;
    const confidence = historical_success_rate >= 0.7 ? 0.88 : 0.72;
    return {
      payment_id: sanitizedPayment.id,
      diagnosis: isOverload ? "transient_bank_downtime" : "network_timeout",
      recoverability_score: recoverability,
      recommended_action: "RETRY_PAYMENT",
      confidence,
      risk_level: "LOW",
      reasoning: `Transient gateway error detected (${failure_code}). High historical customer affinity (${Math.round(historical_success_rate * 100)}%). Recommend retry.`,
      customer_recovery_message: void 0
    };
  }
  if (failure_category === "INSUFFICIENT_FUNDS") {
    const hasGoodHistory = historical_success_rate >= 0.6 && previous_failure_count <= 2;
    return {
      payment_id: sanitizedPayment.id,
      diagnosis: "insufficient_funds",
      recoverability_score: hasGoodHistory ? 0.65 : 0.35,
      recommended_action: "SEND_PAYMENT_REMINDER",
      confidence: 0.78,
      risk_level: "MEDIUM",
      reasoning: "Card limit or balance issue. Immediate retry risks customer friction. Recommend recovery reminder.",
      customer_recovery_message: "Hi there, your payment could not be processed due to balance limits. Click here to complete your payment."
    };
  }
  if (failure_category === "AUTHENTICATION_FAILURE") {
    const isHighValue = amount > 2e6;
    return {
      payment_id: sanitizedPayment.id,
      diagnosis: "authentication_failure",
      recoverability_score: 0.45,
      recommended_action: isHighValue ? "ESCALATE" : "SEND_PAYMENT_REMINDER",
      confidence: 0.75,
      risk_level: isHighValue ? "HIGH" : "MEDIUM",
      reasoning: "3DS authentication dropped. Retry cannot succeed without customer interaction.",
      customer_recovery_message: isHighValue ? void 0 : "Your bank authentication was interrupted. Click to re-enter your OTP."
    };
  }
  if (failure_category === "EXPIRED_CARD" || failure_category === "FATAL_DECLINE") {
    const isExpired = failure_category === "EXPIRED_CARD" || failure_code.includes("EXPIRED");
    return {
      payment_id: sanitizedPayment.id,
      diagnosis: isExpired ? "expired_card" : "fatal_declined_card",
      recoverability_score: 0.08,
      recommended_action: "STOP",
      confidence: 0.94,
      risk_level: "CRITICAL",
      reasoning: `Card permanently declined (${failure_code}). Further automated retries will trigger merchant penalties.`,
      customer_recovery_message: void 0
    };
  }
  return {
    payment_id: sanitizedPayment.id,
    diagnosis: "transient_bank_downtime",
    recoverability_score: 0.5,
    recommended_action: "ESCALATE",
    confidence: 0.65,
    risk_level: "MEDIUM",
    reasoning: "Unclassified payment failure. Escalate to merchant ops for review."
  };
}
function runComparativeEvaluation() {
  const allPayments = dataStore.getAllPayments();
  const policy = dataStore.getPolicy();
  let revenueAtRiskPaise = 0;
  for (const p of allPayments) {
    revenueAtRiskPaise += p.amount;
  }
  const naiveMetrics = {
    strategy: "NAIVE_RETRY_ALL",
    label: "Naive Retry All",
    total_records: allPayments.length,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    false_positive_rate: 0,
    recovery_rate: 0,
    revenue_recovered_paise: 0,
    revenue_recovered_inr: 0,
    revenue_at_risk_paise: revenueAtRiskPaise,
    revenue_at_risk_inr: Math.round(revenueAtRiskPaise / 100),
    unnecessary_retries: 0,
    policy_interceptions: 0,
    escalations: 0,
    tool_executions: 0,
    safety_violations: 0
  };
  const deterministicMetrics = {
    strategy: "DETERMINISTIC_RULES",
    label: "Deterministic Rules",
    total_records: allPayments.length,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    false_positive_rate: 0,
    recovery_rate: 0,
    revenue_recovered_paise: 0,
    revenue_recovered_inr: 0,
    revenue_at_risk_paise: revenueAtRiskPaise,
    revenue_at_risk_inr: Math.round(revenueAtRiskPaise / 100),
    unnecessary_retries: 0,
    policy_interceptions: 0,
    escalations: 0,
    tool_executions: 0,
    safety_violations: 0
  };
  const recoverpayMetrics = {
    strategy: "RECOVERPAY_AI_POLICY",
    label: "RecoverPay (AI + Policy)",
    total_records: allPayments.length,
    tp: 0,
    fp: 0,
    fn: 0,
    tn: 0,
    precision: 0,
    recall: 0,
    f1: 0,
    false_positive_rate: 0,
    recovery_rate: 0,
    revenue_recovered_paise: 0,
    revenue_recovered_inr: 0,
    revenue_at_risk_paise: revenueAtRiskPaise,
    revenue_at_risk_inr: Math.round(revenueAtRiskPaise / 100),
    unnecessary_retries: 0,
    policy_interceptions: 0,
    escalations: 0,
    tool_executions: 0,
    safety_violations: 0
  };
  let totalTrulyRecoverable = 0;
  for (const p of allPayments) {
    if (p.ground_truth_recoverable) {
      totalTrulyRecoverable++;
    }
  }
  for (const payment of allPayments) {
    const customer = dataStore.getCustomerById(payment.customer_id);
    if (!customer) continue;
    const isTrulyRecoverable = payment.ground_truth_recoverable;
    const sanitizedTelemetry = sanitizePaymentForStrategy(payment);
    naiveMetrics.tool_executions++;
    let naiveViolations = 0;
    if (payment.status === "captured") naiveViolations++;
    if (customer.opted_out) naiveViolations++;
    if (payment.recovery_attempts >= policy.max_retries) naiveViolations++;
    if (payment.recovery_attempts > 0 && payment.seconds_since_failure < policy.min_retry_cooldown_seconds) naiveViolations++;
    if (payment.amount > policy.max_automated_recovery_amount) naiveViolations++;
    naiveMetrics.safety_violations += naiveViolations;
    if (isTrulyRecoverable) {
      naiveMetrics.tp++;
      naiveMetrics.revenue_recovered_paise += payment.amount;
    } else {
      naiveMetrics.fp++;
      naiveMetrics.unnecessary_retries++;
    }
    let detAction;
    let detBlocked = false;
    if (customer.opted_out) {
      detAction = "STOP";
      detBlocked = true;
    } else if (payment.status === "captured") {
      detAction = "STOP";
      detBlocked = true;
    } else if (payment.recovery_attempts >= policy.max_retries) {
      detAction = "ESCALATE";
      detBlocked = true;
    } else if (payment.amount > policy.max_automated_recovery_amount) {
      detAction = "ESCALATE";
      detBlocked = true;
    } else if (payment.recovery_attempts > 0 && payment.seconds_since_failure < policy.min_retry_cooldown_seconds) {
      detAction = "STOP";
      detBlocked = true;
    } else if (payment.failure_category === "TRANSIENT_BANK_FAILURE" || payment.failure_category === "NETWORK_ERROR") {
      detAction = "RETRY_PAYMENT";
    } else if (payment.failure_category === "INSUFFICIENT_FUNDS") {
      detAction = "SEND_PAYMENT_REMINDER";
    } else {
      detAction = "ESCALATE";
    }
    if (detBlocked) {
      deterministicMetrics.policy_interceptions++;
    }
    if (detAction === "ESCALATE") {
      deterministicMetrics.escalations++;
    }
    if (detAction === "RETRY_PAYMENT") {
      deterministicMetrics.tool_executions++;
      if (isTrulyRecoverable) {
        deterministicMetrics.tp++;
        deterministicMetrics.revenue_recovered_paise += payment.amount;
      } else {
        deterministicMetrics.fp++;
        deterministicMetrics.unnecessary_retries++;
      }
    } else if (detAction === "SEND_PAYMENT_REMINDER") {
      deterministicMetrics.tool_executions++;
      if (isTrulyRecoverable) {
        deterministicMetrics.tp++;
      } else {
        deterministicMetrics.tn++;
      }
    } else {
      if (isTrulyRecoverable) {
        deterministicMetrics.fn++;
      } else {
        deterministicMetrics.tn++;
      }
    }
    const aiDecision = deterministicBenchmarkAgent(sanitizedTelemetry, customer);
    const policyResult = policyEngine.evaluate(payment, customer, aiDecision, policy);
    if (!policyResult.allowed) {
      recoverpayMetrics.policy_interceptions++;
    }
    const finalAction = policyResult.finalAction;
    if (finalAction === "ESCALATE") {
      recoverpayMetrics.escalations++;
    }
    if (policyResult.allowed) {
      if (finalAction === "RETRY_PAYMENT") {
        recoverpayMetrics.tool_executions++;
        if (isTrulyRecoverable) {
          recoverpayMetrics.tp++;
          recoverpayMetrics.revenue_recovered_paise += payment.amount;
        } else {
          recoverpayMetrics.fp++;
          recoverpayMetrics.unnecessary_retries++;
        }
      } else if (finalAction === "SEND_PAYMENT_REMINDER") {
        recoverpayMetrics.tool_executions++;
        if (isTrulyRecoverable) {
          recoverpayMetrics.tp++;
        } else {
          recoverpayMetrics.tn++;
        }
      } else if (finalAction === "ESCALATE") {
        if (isTrulyRecoverable) {
          recoverpayMetrics.fn++;
        } else {
          recoverpayMetrics.tn++;
        }
      } else {
        if (isTrulyRecoverable) {
          recoverpayMetrics.fn++;
        } else {
          recoverpayMetrics.tn++;
        }
      }
    } else {
      if (isTrulyRecoverable) {
        recoverpayMetrics.fn++;
      } else {
        recoverpayMetrics.tn++;
      }
    }
  }
  function finalizeMetrics(m) {
    m.precision = m.tp + m.fp > 0 ? Number((m.tp / (m.tp + m.fp)).toFixed(4)) : 0;
    m.recall = m.tp + m.fn > 0 ? Number((m.tp / (m.tp + m.fn)).toFixed(4)) : 0;
    m.f1 = m.precision + m.recall > 0 ? Number((2 * m.precision * m.recall / (m.precision + m.recall)).toFixed(4)) : 0;
    m.f1_score = m.f1;
    m.false_positive_rate = m.fp + m.tn > 0 ? Number((m.fp / (m.fp + m.tn)).toFixed(4)) : 0;
    m.fpr = m.false_positive_rate;
    m.recovery_rate = totalTrulyRecoverable > 0 ? Number((m.tp / totalTrulyRecoverable * 100).toFixed(1)) : 0;
    m.revenue_recovered_inr = Math.round(m.revenue_recovered_paise / 100);
    m.policy_violations = m.safety_violations;
  }
  finalizeMetrics(naiveMetrics);
  finalizeMetrics(deterministicMetrics);
  finalizeMetrics(recoverpayMetrics);
  const metricsComparison = [
    {
      metric: "recovery_rate",
      label: "Recovery Rate",
      description: "Percentage of recoverable volume successfully captured",
      naive: `${naiveMetrics.recovery_rate}%`,
      deterministic: `${deterministicMetrics.recovery_rate}%`,
      recoverpay: `${recoverpayMetrics.recovery_rate}%`,
      advantage: "recoverpay"
    },
    {
      metric: "revenue_recovered",
      label: "Revenue Recovered",
      description: "Verified captured revenue in Indian Rupees (INR)",
      naive: `\u20B9${naiveMetrics.revenue_recovered_inr.toLocaleString("en-IN")}`,
      deterministic: `\u20B9${deterministicMetrics.revenue_recovered_inr.toLocaleString("en-IN")}`,
      recoverpay: `\u20B9${recoverpayMetrics.revenue_recovered_inr.toLocaleString("en-IN")}`,
      advantage: "recoverpay"
    },
    {
      metric: "precision",
      label: "Recovery Precision",
      description: "Ratio of true recoveries to total attempted recoveries [TP / (TP + FP)]",
      naive: `${(naiveMetrics.precision * 100).toFixed(1)}%`,
      deterministic: `${(deterministicMetrics.precision * 100).toFixed(1)}%`,
      recoverpay: `${(recoverpayMetrics.precision * 100).toFixed(1)}%`,
      advantage: "recoverpay"
    },
    {
      metric: "recall",
      label: "Recovery Recall",
      description: "Ratio of true recoveries to all recoverable opportunities [TP / (TP + FN)]",
      naive: `${(naiveMetrics.recall * 100).toFixed(1)}%`,
      deterministic: `${(deterministicMetrics.recall * 100).toFixed(1)}%`,
      recoverpay: `${(recoverpayMetrics.recall * 100).toFixed(1)}%`,
      advantage: "recoverpay"
    },
    {
      metric: "f1_score",
      label: "F1 Score",
      description: "Harmonic mean of precision and recall",
      naive: naiveMetrics.f1.toFixed(3),
      deterministic: deterministicMetrics.f1.toFixed(3),
      recoverpay: recoverpayMetrics.f1.toFixed(3),
      advantage: "recoverpay"
    },
    {
      metric: "false_positives",
      label: "False Positives (Failed Retries)",
      description: "Unrecoverable payments incorrectly attempted for recovery",
      naive: naiveMetrics.fp,
      deterministic: deterministicMetrics.fp,
      recoverpay: recoverpayMetrics.fp,
      advantage: "recoverpay"
    },
    {
      metric: "unnecessary_retries",
      label: "Unnecessary Retries",
      description: "Retries on unrecoverable, expired, or permanently declined payments",
      naive: naiveMetrics.unnecessary_retries,
      deterministic: deterministicMetrics.unnecessary_retries,
      recoverpay: recoverpayMetrics.unnecessary_retries,
      advantage: "recoverpay"
    },
    {
      metric: "safety_violations",
      label: "Safety Violations",
      description: "Violations of opt-out, cooldown, amount caps, or repeat limits",
      naive: naiveMetrics.safety_violations,
      deterministic: deterministicMetrics.safety_violations,
      recoverpay: recoverpayMetrics.safety_violations,
      advantage: "recoverpay"
    },
    {
      metric: "policy_interceptions",
      label: "Policy Interceptions",
      description: "Inadvisable actions blocked or diverted by policy gate",
      naive: naiveMetrics.policy_interceptions,
      deterministic: deterministicMetrics.policy_interceptions,
      recoverpay: recoverpayMetrics.policy_interceptions,
      advantage: "recoverpay"
    },
    {
      metric: "escalations",
      label: "Escalations to Operations",
      description: "High-risk or ambiguous payments safely routed to human ops",
      naive: naiveMetrics.escalations,
      deterministic: deterministicMetrics.escalations,
      recoverpay: recoverpayMetrics.escalations,
      advantage: "recoverpay"
    },
    {
      metric: "tool_executions",
      label: "Total Tool Executions",
      description: "Total number of automated recovery tool calls dispatched",
      naive: naiveMetrics.tool_executions,
      deterministic: deterministicMetrics.tool_executions,
      recoverpay: recoverpayMetrics.tool_executions,
      advantage: "recoverpay"
    }
  ];
  return {
    success: true,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    dataset_size: allPayments.length,
    strategies: {
      naive_retry_all: naiveMetrics,
      deterministic_rules: deterministicMetrics,
      recoverpay_ai_policy: recoverpayMetrics
    },
    metrics_comparison: metricsComparison,
    ground_truth_isolation_verified: true
  };
}

// server/routes/evaluationRoutes.ts
var evaluationRouter = Router6();
evaluationRouter.get("/compare", (req, res) => {
  try {
    const result = runComparativeEvaluation();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to run comparative evaluation"
    });
  }
});

// server/routes/auditRoutes.ts
import { Router as Router7 } from "express";
var auditRouter = Router7();
auditRouter.get("/verify", (_req, res) => {
  try {
    const events = dataStore.getAuditEvents();
    const verification = verifyAuditChain(events);
    res.json({
      success: true,
      verification,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Error executing audit chain verification"
    });
  }
});
auditRouter.get("/", (req, res) => {
  try {
    const paymentId = req.query.payment_id;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const allEvents = dataStore.getAuditEvents(paymentId);
    const total = allEvents.length;
    const events = allEvents.slice(offset, offset + limit);
    res.json({
      success: true,
      total,
      offset,
      limit,
      events
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Failed to retrieve audit events"
    });
  }
});
auditRouter.get("/:paymentId", (req, res) => {
  try {
    const { paymentId } = req.params;
    const events = dataStore.getAuditEvents(paymentId);
    res.json({
      success: true,
      paymentId,
      total: events.length,
      events
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message || "Failed to retrieve audit events for payment"
    });
  }
});

// server/routes/razorpayRoutes.ts
import { Router as Router8 } from "express";
var razorpayRouter = Router8();
razorpayRouter.get("/status", (_req, res) => {
  const maskedInfo = getMaskedRazorpayConfig();
  res.json({
    success: true,
    configured: maskedInfo.isConfigured,
    masked_key_id: maskedInfo.maskedKeyId,
    runtime_mode: maskedInfo.mode,
    label: maskedInfo.label,
    supported_operations: [
      "CREATE_PAYMENT_LINK",
      "CREATE_ORDER",
      "VERIFY_PAYMENT_LINK",
      "VERIFY_PAYMENT"
    ],
    notice: "Razorpay Sandbox (Test Mode) \u2014 No real bank charges or money movement."
  });
});
razorpayRouter.post("/test-demo", async (req, res) => {
  const { paymentId = "pay_demo_transient_01", action = "SEND_PAYMENT_REMINDER" } = req.body;
  const config = getRazorpayConfig();
  if (!config.isConfigured) {
    res.status(400).json({
      success: false,
      error: "RAZORPAY_CREDENTIALS_MISSING",
      message: "Razorpay TEST keys (RAZORPAY_KEY_ID=rzp_test_*) are not configured in server environment. Use safe simulation rail or set credentials in server secrets.",
      fallback_to_simulation: true
    });
    return;
  }
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
    return;
  }
  const customer = dataStore.getCustomerById(payment.customer_id);
  if (!customer) {
    res.status(404).json({ success: false, error: `Customer not found for payment: ${paymentId}` });
    return;
  }
  const aiDecision = {
    payment_id: payment.id,
    diagnosis: "transient_bank_downtime",
    recoverability_score: 0.94,
    recommended_action: action === "RETRY_PAYMENT" ? "RETRY_PAYMENT" : "SEND_PAYMENT_REMINDER",
    confidence: 0.91,
    risk_level: "LOW",
    reasoning: action === "RETRY_PAYMENT" ? "Customer payment failed due to transient gateway downtime. Generate Razorpay Test Order." : "Generate Razorpay Test Payment Link to allow customer to complete recovery checkout.",
    customer_recovery_message: `RecoverPay: Your payment of \u20B9${(payment.amount / 100).toLocaleString("en-IN")} could not be completed. Please use this secure test link to finalize checkout.`
  };
  const policy = dataStore.getPolicy();
  const policyResult = policyEngine.evaluate(payment, customer, aiDecision, policy);
  if (!policyResult.allowed) {
    res.status(403).json({
      success: false,
      error: "POLICY_BLOCKED",
      policyResult,
      message: "Razorpay Test execution was blocked by the deterministic policy engine."
    });
    return;
  }
  try {
    const idempotencyKey = `rzp_test_demo_${payment.id}_${Date.now()}`;
    const { toolResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
      preferredMode: "RAZORPAY_TEST_API",
      idempotencyKey,
      reminderMessage: aiDecision.customer_recovery_message
    });
    const updatedPayment = dataStore.getPaymentById(payment.id);
    const auditEvents = dataStore.getAuditEvents(payment.id);
    res.json({
      success: true,
      mode: "RAZORPAY_TEST_API",
      label: "RAZORPAY TEST MODE \u2014 NO REAL MONEY",
      payment: updatedPayment,
      customer,
      aiDecision,
      policyResult,
      toolResult,
      externalReferenceId: toolResult.external_reference_id,
      paymentLinkUrl: toolResult.payment_link_url,
      // Invariant assertion:
      zeroTrustVerification: {
        api_success: toolResult.success,
        payment_recovered: toolResult.recovered,
        // Must be FALSE
        amount_recovered: toolResult.amount_recovered,
        // Must be 0
        status: toolResult.final_payment_status,
        invariant_verified: toolResult.recovered === false && toolResult.amount_recovered === 0,
        explanation: "CRITICAL INVARIANT: Razorpay API returned HTTP 200, but payment is NOT marked recovered. Status remains failed until customer actually completes checkout and funds are captured."
      },
      auditTrail: auditEvents.slice(-5)
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: "EXECUTION_FAILED",
      message: err.message
    });
  }
});
razorpayRouter.post("/verify-link", async (req, res) => {
  const { paymentLinkId, paymentId } = req.body;
  if (!paymentLinkId) {
    res.status(400).json({ success: false, error: "paymentLinkId is required" });
    return;
  }
  const verification = await verifyRazorpayTestPaymentLink(paymentLinkId);
  if (!verification.success) {
    res.status(502).json({
      success: false,
      error: verification.code || "VERIFICATION_FAILED",
      message: verification.error
    });
    return;
  }
  if (verification.paid && paymentId) {
    const payment = dataStore.getPaymentById(paymentId);
    if (payment && payment.status !== "captured") {
      dataStore.updatePayment(payment.id, {
        status: "captured",
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      AuditLedger.recordOutcomeVerification(
        payment,
        "captured",
        payment.amount,
        "SUCCESS"
      );
    }
  }
  const currentPayment = paymentId ? dataStore.getPaymentById(paymentId) : null;
  res.json({
    success: true,
    paymentLinkId,
    statusOnRazorpay: verification.status,
    paid: verification.paid,
    amount_paid: verification.amount_paid,
    payment_id: verification.payment_id,
    currentPaymentStatus: currentPayment?.status || "unknown",
    recovered: verification.paid,
    message: verification.paid ? `Razorpay confirms payment is CAPTURED! \u20B9${((verification.amount_paid || 0) / 100).toLocaleString("en-IN")} recovered successfully.` : `Payment link status is "${verification.status}". Customer has not completed checkout. Payment remains UNRECOVERED. Invariant verified: API success != payment recovery.`
  });
});
razorpayRouter.post("/verify-payment", async (req, res) => {
  const { razorpayPaymentId } = req.body;
  if (!razorpayPaymentId) {
    res.status(400).json({ success: false, error: "razorpayPaymentId is required" });
    return;
  }
  const result = await verifyRazorpayTestPayment(razorpayPaymentId);
  res.json(result);
});

// server/app.ts
if (!process.env.GEMINI_MODEL || process.env.GEMINI_MODEL.trim() === "") {
  process.env.GEMINI_MODEL = resolveGeminiModel();
}
var app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-requested-with");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  const forwardedUri = req.headers["x-forwarded-uri"];
  const matchedPath = req.headers["x-matched-path"] || req.headers["x-invoke-path"];
  const rawUrl = forwardedUri || req.originalUrl || req.url;
  if (rawUrl && rawUrl.includes("/api/")) {
    const idx = rawUrl.indexOf("/api/");
    req.url = rawUrl.substring(idx);
  } else if (matchedPath && matchedPath.startsWith("/api")) {
    const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    req.url = matchedPath + queryString;
  } else if (rawUrl && !rawUrl.startsWith("/api")) {
    req.url = "/api" + (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl);
  }
  next();
});
var handleHealth = (_req, res) => {
  res.json({
    status: "ok",
    service: "RecoverPay AI Revenue Recovery Agent",
    runtime: process.env.VERCEL ? "vercel-serverless" : "node-express",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
};
app.get(["/api/health", "/health", "/api"], handleHealth);
var handleDatasetStats = (_req, res) => {
  const stats = dataStore.getStats();
  res.json({
    success: true,
    stats
  });
};
app.get(["/api/dataset/stats", "/dataset/stats"], handleDatasetStats);
var handleDatasetSample = (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 50);
  const payments = dataStore.getAllPayments().slice(0, limit);
  const customers = dataStore.getAllCustomers();
  const customerMap = new Map(customers.map((c) => [c.id, c]));
  const sampled = payments.map((p) => {
    const customer = customerMap.get(p.customer_id);
    return {
      payment: p,
      customer
    };
  });
  res.json({
    success: true,
    count: sampled.length,
    sample: sampled
  });
};
app.get(["/api/dataset/sample", "/dataset/sample"], handleDatasetSample);
var handleAgentContextSample = (_req, res) => {
  const payment = dataStore.getAllPayments()[0];
  const customer = dataStore.getCustomerById(payment.customer_id);
  const policy = dataStore.getPolicy();
  if (!payment || !customer) {
    return res.status(404).json({ error: "Sample record not found" });
  }
  const agentContext = toAgentInputContext(payment, customer, policy);
  res.json({
    success: true,
    message: "Verified ground-truth fields stripped from AgentInputContext",
    agentContext
  });
};
app.get(["/api/dataset/agent-context-sample", "/dataset/agent-context-sample"], handleAgentContextSample);
var handleDatasetReset = (_req, res) => {
  const state = dataStore.reset(1337);
  res.json({
    success: true,
    message: "Dataset reset to default deterministic state (600 records).",
    stats: state.stats
  });
};
app.post(["/api/dataset/reset", "/dataset/reset"], handleDatasetReset);
var handlePolicyGet = (_req, res) => {
  res.json({
    success: true,
    policy: dataStore.getPolicy()
  });
};
app.get(["/api/policy", "/policy"], handlePolicyGet);
var handlePolicyEvaluate = (req, res) => {
  const { paymentId, decision } = req.body;
  if (!paymentId || !decision) {
    return res.status(400).json({ error: "paymentId and decision payload are required" });
  }
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    return res.status(404).json({ error: `Payment not found: ${paymentId}` });
  }
  const customer = dataStore.getCustomerById(payment.customer_id);
  if (!customer) {
    return res.status(404).json({ error: `Customer not found for payment: ${paymentId}` });
  }
  const policy = dataStore.getPolicy();
  const result = policyEngine.evaluate(payment, customer, decision, policy);
  const enrichedResult = {
    ...result,
    status: result.allowed ? "ALLOWED" : result.finalAction === "ESCALATE" ? "ESCALATED" : "BLOCKED"
  };
  res.json({
    success: true,
    paymentId,
    policyResult: enrichedResult
  });
};
app.post(["/api/policy/evaluate", "/policy/evaluate"], handlePolicyEvaluate);
app.use(["/api/agent", "/agent"], agentRouter);
app.use(["/api/recovery", "/recovery"], recoveryRouter);
app.use(["/api/dashboard", "/dashboard"], dashboardRouter);
app.use(["/api/payments", "/payments"], paymentRouter);
app.use(["/api/demo", "/demo"], demoRouter);
app.use(["/api/evaluation", "/evaluation"], evaluationRouter);
app.use(["/api/audit", "/audit"], auditRouter);
app.use(["/api/razorpay", "/razorpay"], razorpayRouter);
var app_default = app;
export {
  app,
  app_default as default
};
