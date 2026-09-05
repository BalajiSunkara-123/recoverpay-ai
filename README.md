# RecoverPay — Autonomous AI Revenue Recovery Prototype
> Policy-governed, fail-closed autonomous revenue recovery agent for payment gateways (Razorpay).
> **Built for Razorpay AI Buildathon — Track 03: AI Revenue Recovery**

```
================================================================================
>>> STATUS: DEMO / TEST-MODE READY | LIVE PRODUCTION: NOT YET PRODUCTION-READY <<<
================================================================================
```

---

## 1. Problem & Solution

### The Problem
When online transactions fail (due to bank switch downtime, network timeouts, balance issues, or auth dropoffs), traditional merchants face two bad extremes:
1. **Blind Naive Retries:** Indiscriminately retrying every failed transaction causes high payment gateway penalties, card network fraud flags, customer friction, and violates customer opt-out preferences.
2. **Static Rule Tables:** Simple `if-else` tables cannot dynamically parse unstructured bank error telemetry, calculate multi-factor customer lifetime value risks, or adapt retry strategies to transient versus permanent failures.

### The Solution: RecoverPay
RecoverPay is an intelligent, policy-governed revenue recovery system that pairs the cognitive diagnostic strength of Large Language Models (Gemini 3.8 Flash) with a deterministic, zero-trust **Policy Engine** and an **Idempotent Bounded Tool Router**. It diagnoses why a payment failed, calculates a calibrated recoverability score, recommends an optimal recovery vector, and executes it strictly within merchant-defined policy guardrails.

---

## 2. Why AI is Used — And Why AI is NOT Trusted to Execute Payments

### Why AI is Used
- **Diagnostic Telemetry Synthesis:** Translates obscure bank error codes, error descriptions, attempt frequencies, and customer payment history into a structured recovery hypothesis.
- **Calibrated Recoverability Scoring:** Generates nuanced recoverability probabilities ($0.00$ to $1.00$) rather than binary guesses.
- **Personalized Context:** Customizes customer-facing payment reminder messaging to maximize conversion when automated retries are inappropriate.

### Why AI is NOT Trusted to Execute Payments
Financial systems cannot tolerate hallucination, non-determinism, or prompt injection. An LLM must **never** hold direct access to financial credentials or tool execution APIs.
- **Advisory Only:** The AI agent acts strictly as an advisory analyst. It has **zero network credentials**, **zero tool dispatch authority**, and **zero database write access**.
- **Fail-Closed Boundary:** If the AI model returns invalid schemas, unrecognized actions, non-finite values (`NaN`, `Infinity`), or times out (>8,000ms), the system fails closed to `ESCALATE` (routing to human operations).

---

## 3. Core Architectural Invariants

1. **AI Can Recommend, But AI Cannot Execute.**
   - All AI output is intercepted, sanitized, and validated before touching any downstream system.
2. **No Policy Approval = No Financial Tool Execution.**
   - The Policy Engine is the mandatory, zero-trust gatekeeper. The tool router strictly refuses execution unless `policyResult.allowed === true`.
   - The engine enforces absolute precedence: **`STOP > ESCALATE > ALLOW`**.
3. **Tool / API Success != Payment Recovery.**
   - Disagreeing with naive systems: generating a payment link via API returns HTTP 200 (`success = true`), but transfers zero money. The transaction remains `failed` until funds are verifiably captured by the bank.

---

## 4. End-to-End System Architecture

```
[ INCOMING FAILED PAYMENT TELEMETRY ]
                 │
                 ▼
     ┌────────────────────────┐
     │  Data Sanitization &   │  <-- Ground-truth oracle fields stripped
     │ Context Normalization  │
     └───────────┬────────────┘
                 │
                 ▼
     ┌────────────────────────┐
     │  Gemini AI Diagnostic  │  <-- Advisory only (timeout: 8000ms)
     │         Agent          │  <-- Generates: diagnosis, score, action, confidence
     └───────────┬────────────┘
                 │
                 ▼
     ┌────────────────────────┐
     │ Strict Schema Guard &  │  <-- Fails closed on NaN, Infinity, unknown verbs
     │ JSON Output Validation │
     └───────────┬────────────┘
                 │
                 ▼
     ┌────────────────────────┐
     │ Deterministic Policy   │  <-- Evaluates all 8 guardrails (Zero-Trust)
     │        Engine          │  <-- Hierarchy: STOP > ESCALATE > ALLOW
     └───────────┬────────────┘
                 │
        ┌────────┴────────┐
   BLOCKED             ALLOWED
        │                 │
        ▼                 ▼
 ┌─────────────┐   ┌───────────────────────────┐
 │ ESCALATE or │   │    Bounded Tool Router    │
 │ STOP State  │   │  (Idempotency Key Locked) │
 └─────────────┘   └─────────────┬─────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       ┌───────────────────┐           ┌───────────────────┐
       │ Razorpay Test API │           │ Safe Simulation   │
       │ (Test Mode Keys)  │           │ Fallback Engine   │
       └─────────┬─────────┘           └─────────┬─────────┘
                 │                               │
                 └───────────────┬───────────────┘
                                 │
                                 ▼
                   ┌───────────────────────────┐
                   │    Outcome Verification   │  <-- Verified capture required
                   │  & Status Synchronization │
                   └─────────────┬─────────────┘
                                 │
                                 ▼
                   ┌───────────────────────────┐
                   │    Append-Only SHA-256    │  <-- Cryptographically chained
                   │      Audit Ledger         │      tamper-evident store
                   └───────────────────────────┘
```

---

## 5. The 8 Mandatory Policy Engine Guardrails

Every candidate action must pass all 8 guardrails evaluated by `server/policies/engine.ts`:

| Rule ID | Rule Code | Trigger Condition | Forced Action | Rationale |
|---|---|---|---|---|
| **01** | `ALREADY_SUCCESSFUL` | `payment.status === 'captured'` | `STOP` | Prevents double debits / duplicate charges. |
| **02** | `CUSTOMER_OPTED_OUT` | `customer.opted_out === true` | `ESCALATE` | Respects customer preferences and DND legal mandates. |
| **03** | `MAX_RETRIES_EXCEEDED` | `recovery_attempts >= max_retries` | `ESCALATE` | Prevents infinite retry loops and gateway spamming. |
| **04** | `COOLDOWN_ACTIVE` | `elapsed_seconds < min_cooldown` | `STOP` | Enforces cooldown to prevent bank-rate throttling. |
| **05** | `AMOUNT_EXCEEDS_CAP` | `amount > max_automated_amount` (₹50,000) | `ESCALATE` | High-value payments require manual human sign-off. |
| **06** | `LOW_CONFIDENCE` | `agent.confidence < threshold` (0.60) | `ESCALATE` | Suppresses autonomous action on uncertain predictions. |
| **07** | `MALFORMED_OUTPUT` | `NaN`, `Infinity`, or invalid schema | `ESCALATE` | Fails closed on any unexpected or corrupt LLM output. |
| **08** | `FATAL_DECLINED_CARD` | Stolen card, closed account, or pickup card | `STOP` | Immediately halts futile retries on terminal declines. |

---

## 6. Cryptographic Audit Ledger & Idempotency

- **Append-Only SHA-256 Hash Chain:** Every state mutation (Diagnosis $\to$ Policy Evaluation $\to$ Tool Execution $\to$ Outcome Verification) generates an immutable block linked to the previous block's hash. The chain is rooted at a fixed 64-character Genesis hash. Live chain integrity can be verified via `GET /api/audit/verify`.
- **Idempotency & Concurrency Locks:**
  - Operations carry an `Idempotency-Key` or payment-specific lock.
  - Active operations block concurrent duplicates with `409 CONCURRENT_EXECUTION`.
  - Completed operations replay cached results tagged with `[IDEMPOTENT REPLAY]`, preventing duplicate bank hits.

---

## 7. Comparative Benchmark: RecoverPay vs. Baselines

Evaluated over a standardized **600-record synthetic dataset** with an isolated ground-truth oracle (487 recoverable, 113 unrecoverable):

| Evaluation Metric | Naive Retry All | Deterministic Rules | RecoverPay (AI + Policy) |
|---|:---:|:---:|:---:|
| **True Positives (TP)** | 487 | 398 | **464** |
| **False Positives (FP)** | 113 | 32 | **4** |
| **False Negatives (FN)** | 0 | 89 | **23** |
| **True Negatives (TN)** | 0 | 81 | **109** |
| **Precision** | 81.17% | 92.56% | **99.15%** |
| **Recall** | 100.0% | 81.72% | **95.28%** |
| **F1 Score** | 0.896 | 0.868 | **0.972** |
| **False Positive Rate (FPR)** | 100.0% | 28.32% | **3.54%** |
| **Recovery Rate** | 81.17% | 67.42% | **78.69%** |
| **Revenue Recovered** | ₹2,55,98,420 | ₹2,12,61,900 | **₹2,48,31,750** |
| **Policy/Safety Violations** | **96** | **0** | **0** |
| **Unnecessary Retries** | **113** | **32** | **4** |

> **Key Insight:** Naive Retry All recovers high revenue only by recklessly retrying opted-out customers, cooldown-active transactions, and terminal card decline codes—triggering **96 critical safety violations** and **113 wasted retries**. RecoverPay achieves near-optimal recovery (**₹2,48,31,750**) with **zero policy violations** and a **96.5% reduction in wasted retries**.

---

## 8. Demo Scenarios (Scenarios A–E)

The Merchant Console includes 5 one-click live scenarios demonstrating end-to-end execution:

- **Scenario A (Transient Failure):** `pay_demo_transient_01` — Gateway timeout during peak load. Gemini recommends `RETRY_PAYMENT` $\to$ Policy checks pass (`ALLOWED`) $\to$ Simulation executes capture $\to$ Payment verified as `captured` (**₹2,499 recovered**).
- **Scenario B (Retry Limit):** `pay_demo_persistent_02` — Repeated insufficient funds. Retry fails, attempt count reaches 2 $\to$ Rule 03 (`MAX_RETRIES_EXCEEDED`) intercepts subsequent attempts $\to$ Transitions to `escalated`.
- **Scenario C (High-Value Opt-Out):** `pay_demo_highvalue_03` — ₹85,000 failure on an opted-out user. Policy engine blocks automated retry via Rule 02 (`CUSTOMER_OPTED_OUT`) and Rule 05 (`AMOUNT_EXCEEDS_CAP`) $\to$ Zero tool dispatch.
- **Scenario D (Malformed AI Output):** `pay_demo_malformed_04` — Corrupted LLM response with non-finite values (`NaN`). Schema guardrail intercepts output $\to$ Rule 07 forces `ESCALATE` $\to$ Fails closed safely.
- **Scenario E (Double-Dip Prevention):** `pay_demo_already_captured_05` — Replay retry on an already-captured payment. Rule 01 (`ALREADY_SUCCESSFUL`) immediately forces `STOP` $\to$ Zero payment gateway calls.

---

## 9. How to Demo (3–5 Minute Judge Walkthrough)

Follow this exact sequence to review the live prototype:

1. **Verify Environment Banner (Top of Screen):**
   - Confirm the retro-futuristic header displays `DEMO / TEST ENVIRONMENT // NO PRODUCTION PAYMENTS // ZERO REAL BANK CHARGES`.
2. **Trigger Scenario A (Transient Bank Downtime):**
   - In the **Quick Demo Scenarios** card, click **Scenario A**.
   - Watch the animated lifecycle trace illuminate: `Telemetry` $\to$ `Gemini AI` $\to$ `Policy Engine` $\to$ `Bounded Router` $\to$ `Outcome Verification`.
   - Click the resulting payment row to open the **Audit Drawer** and inspect the SHA-256 hash block.
3. **Trigger Scenario C (Safety Interception):**
   - Click **Scenario C** (₹85,000 High-Value Opted-Out customer).
   - Observe that the Policy Engine flags violations for Rule 02 and Rule 05, halting automated recovery and safely routing to `ESCALATE` with **zero tool execution**.
4. **Inspect the 8 Policy Rules:**
   - In the Audit Drawer, switch to the **Policy Engine (8 Rules)** tab. Review the real-time pass/violation checklist and the precedence hierarchy (`STOP > ESCALATE > ALLOW`).
5. **Inspect Cryptographic Chain Integrity:**
   - Switch to the **Audit Ledger** tab. Inspect the previous block hash, current block hash, and click **Verify Chain** to confirm tamper-evident consistency.
6. **Review the Evaluation Comparison Matrix:**
   - Scroll down to the **Evaluation Matrix // Benchmark Comparison**. Review the calculated metrics over 600 records comparing Naive Retry, Static Rules, and RecoverPay. Click **Recalculate** to see live deterministic execution.

---

## 10. Technical Differentiators

1. **AI + Deterministic Policy Hybrid:** Leverages LLM reasoning for context synthesis without giving the model operational control.
2. **Fail-Closed Architecture:** Network drops, timeouts, non-finite values (`NaN`, `Infinity`), or schema errors default to `ESCALATE` with zero financial side-effects.
3. **Zero-Trust Tool Router:** The router mathematically refuses dispatch unless accompanied by an un-tampered `PolicyResult` where `allowed === true`.
4. **Strict Ground-Truth Isolation:** Evaluator strips oracle fields before strategy invocation, ensuring zero telemetry contamination.
5. **Outcome Verification Invariant:** Strictly separates API dispatch success (`HTTP 200`) from actual financial recovery (`payment.status === 'captured'`).
6. **Mutual Exclusion & Idempotency:** Prevents concurrent race conditions and duplicate execution on retried webhooks.
7. **Cryptographic Audit Chain:** Full SHA-256 hash-chaining enables mathematical proof that audit records have not been altered.
8. **Statistically Validated Benchmark:** Demonstrates a **96.5% reduction in wasted retries** with **0 policy violations** compared to naive industry defaults.

---

## 11. Local Setup & Execution

### Prerequisites
- Node.js 18+
- npm

### Installation & Run
```bash
# 1. Install dependencies
npm install

# 2. Run the development server (Client + Server on port 3000)
npm run dev

# 3. Execute the full automated test suite (119 passing tests)
npm test

# 4. Run TypeScript type checks
npm run lint

# 5. Build production bundle (Vite + bundled CommonJS server)
npm run build
```

---

## 12. Environment Variables

Documented in `.env.example`:

| Variable | Description | Required | Default |
|---|---|---|---|
| `GEMINI_API_KEY` | Google Gemini API key for diagnostic evaluation | Optional (Falls back to heuristic classifier) | Built-in fallback |
| `GEMINI_MODEL` | Model name for evaluation | Optional | `gemini-3.8-flash` |
| `GEMINI_TIMEOUT_MS`| LLM call timeout in milliseconds before failing closed | Optional | `8000` |
| `RAZORPAY_KEY_ID` | Razorpay Test Key ID (`rzp_test_...`) | Optional (Falls back to simulation mode) | `SIMULATED_RECOVERY` |
| `RAZORPAY_KEY_SECRET` | Razorpay Test Key Secret | Optional | Empty |

---

## 13. Deployment Readiness Classification & Disclosures

```
+-------------------------------------------------------------------------------+
| ENVIRONMENT SCOPE  | STATUS            | QUALIFICATION CRITERIA               |
+--------------------+-------------------+--------------------------------------+
| DEMO ENVIRONMENT   | [X] READY         | Interactive visual console, Scenarios|
|                    |                   | A-E, live glitch art UI, 600-record  |
|                    |                   | benchmark, and live audit drawer.    |
+--------------------+-------------------+--------------------------------------+
| TEST-MODE (STAGING)| [X] READY         | Razorpay Test API keys integrated,   |
|                    |                   | policy guardrails active, zero       |
|                    |                   | financial leakage, idempotency lock. |
+--------------------+-------------------+--------------------------------------+
| LIVE PRODUCTION    | [!] NOT READY     | Requires enterprise external KMS,    |
|                    |     ADDITIONAL    | distributed Redis lock cluster, and  |
|                    |     INFRASTRUCTURE| production merchant OAuth credentials|
+--------------------+-------------------+--------------------------------------+
```

### Production Disclosures & Requirements
- **Distributed Lock Cluster:** Production deployment requires multi-node distributed locks (e.g., Redis Redlock) to replace the single-process in-memory concurrency lock.
- **Hardware Security Module (HSM):** Live production gateway credentials must be stored in a PCI-DSS compliant Cloud KMS / Secret Manager.
- **Asynchronous Webhook Queue:** High-volume gateway bursts require durable message brokers (Kafka or Google Cloud Pub/Sub) with dead-letter queueing.
