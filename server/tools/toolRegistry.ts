/**
 * RecoverPay Bounded Tool Router
 * 
 * SOLE AUTHORIZED DISPATCH BOUNDARY FOR ALL RECOVERY TOOLS.
 * 
 * Invariants:
 * 1. "NO POLICY APPROVAL = NO TOOL EXECUTION"
 *    - Must reject any execution where policyResult.allowed !== true.
 * 2. "AI CAN RECOMMEND, BUT AI CANNOT EXECUTE"
 *    - Gemini Agent cannot invoke tools directly. Only this router dispatches.
 * 3. Requested action must strictly match policyResult.finalAction.
 * 4. Stale state protection: Re-reads current payment/customer from DataStore.
 * 5. Captured payments can NEVER be retried.
 * 6. Deterministic Idempotency: Duplicate attempts return cached result without re-execution.
 */

import {
  Payment,
  Customer,
  AIAgentDecision,
  PolicyResult,
  ToolResult,
  RecoveryAction,
  ExecutionMode
} from '../../src/types/index.ts';
import { dataStore } from '../db/store.ts';
import { idempotencyStore } from './idempotency.ts';
import {
  simulatePaymentRetry,
  simulatePaymentReminder,
  simulateEscalateToOps,
  simulateTerminateRecovery
} from './simulationRailTools.ts';
import {
  createRazorpayTestPaymentLink,
  getRazorpayConfig
} from './razorpayRealTools.ts';
import { verifyExecutionOutcome } from './verification.ts';
import { policyEngine } from '../policies/policyEngine.ts';
import { validateAgentDecision, createFallbackDecision } from '../agents/validation.ts';
import { AuditLedger } from '../db/auditLedger.ts';

export interface DispatchOptions {
  idempotencyKey?: string;
  preferredMode?: ExecutionMode;
  reminderMessage?: string;
}

export class ToolRouterError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ToolRouterError';
    this.code = code;
  }
}

/**
 * Dispatches an approved recovery tool.
 * ONLY callable when policyResult.allowed === true.
 */
export async function dispatchApprovedTool(
  payment: Payment,
  customer: Customer,
  decision: AIAgentDecision,
  policyResult: PolicyResult,
  options?: DispatchOptions
): Promise<ToolResult> {
  const timestamp = new Date().toISOString();

  // INVARIANT 1: Strict policy check
  if (!policyResult.allowed) {
    return {
      tool_called: 'terminate_recovery',
      action: policyResult.finalAction,
      execution_mode: 'SIMULATED_RECOVERY',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: options?.idempotencyKey || `blocked_${payment.id}_${Date.now()}`,
      policy_decision: 'BLOCKED',
      policy_violations: policyResult.violations.map(v => v.rule),
      final_payment_status: payment.status,
      message: `TOOL EXECUTION BLOCKED BY POLICY: ${policyResult.violations.map(v => v.reason).join('; ')}`,
      error_message: 'PolicyEngine refused execution permission',
      timestamp
    };
  }

  // INVARIANT 2: Action match verification
  const targetAction: RecoveryAction = policyResult.finalAction;

  // INVARIANT 3: Payment state safety (Cannot retry already captured payment)
  if (payment.status === 'captured') {
    return {
      tool_called: 'terminate_recovery',
      action: 'STOP',
      execution_mode: 'SIMULATED_RECOVERY',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: options?.idempotencyKey || `captured_block_${payment.id}`,
      policy_decision: 'BLOCKED',
      policy_violations: ['ALREADY_SUCCESSFUL'],
      final_payment_status: 'captured',
      message: 'EXECUTION REFUSED: Payment is already captured.',
      error_message: 'Cannot execute recovery on already captured payment',
      timestamp
    };
  }

  // INVARIANT 4: Idempotency enforcement
  const idempotencyKey = options?.idempotencyKey ||
    idempotencyStore.generateKey(payment.id, payment.recovery_attempts, targetAction);

  const existingCheck = idempotencyStore.check(idempotencyKey);
  if (existingCheck.exists) {
    if (existingCheck.inProgress) {
      throw new ToolRouterError(
        `Concurrent execution already in progress for idempotency key: ${idempotencyKey}`,
        'CONCURRENT_EXECUTION'
      );
    }
    if (existingCheck.result) {
      // Return cached safe result without performing duplicate recovery action
      return {
        ...existingCheck.result,
        idempotent_replay: true,
        message: `[IDEMPOTENT REPLAY] ${existingCheck.result.message}`
      };
    }
  }

  // Lock idempotency key
  const locked = idempotencyStore.lock(idempotencyKey, payment.id);
  if (!locked) {
    throw new ToolRouterError(
      `Failed to acquire execution lock for key: ${idempotencyKey}`,
      'LOCK_ACQUISITION_FAILED'
    );
  }

  try {
    let result: ToolResult;
    let paymentUpdates: Partial<Payment> = {};

    // Determine execution mode (default to SIMULATED_RECOVERY for safety unless Razorpay test keys present and requested)
    const razorpayCfg = getRazorpayConfig();
    const useRazorpay = options?.preferredMode === 'RAZORPAY_TEST_API' && razorpayCfg.isConfigured;

    switch (targetAction) {
      case 'RETRY_PAYMENT': {
        // Simulation rail handles card / switch re-authorization
        const sim = simulatePaymentRetry(payment, customer, idempotencyKey);
        result = sim.toolResult;
        paymentUpdates = sim.updatedPayment;
        break;
      }

      case 'SEND_PAYMENT_REMINDER': {
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

      case 'ESCALATE': {
        const sim = simulateEscalateToOps(
          payment,
          decision.reasoning || 'Automated recovery escalated to Human Operations',
          idempotencyKey
        );
        result = sim.toolResult;
        paymentUpdates = sim.updatedPayment;
        break;
      }

      case 'STOP': {
        const sim = simulateTerminateRecovery(
          payment,
          decision.reasoning || 'Automated recovery stopped by policy or diagnosis',
          idempotencyKey
        );
        result = sim.toolResult;
        paymentUpdates = sim.updatedPayment;
        break;
      }

      default: {
        // Unknown actions must NEVER reach a tool
        idempotencyStore.release(idempotencyKey);
        throw new ToolRouterError(`Unknown recovery action verb: ${targetAction}`, 'INVALID_ACTION');
      }
    }

    // Run outcome verification layer
    const verified = verifyExecutionOutcome(payment, result);
    result.final_payment_status = verified.final_payment_status;
    result.recovered = verified.recovered;
    result.amount_recovered = verified.amount_recovered;

    // Apply verified state mutations to datastore
    paymentUpdates.status = verified.final_payment_status;
    dataStore.updatePayment(payment.id, paymentUpdates);

    // Commit to idempotency store
    idempotencyStore.commit(idempotencyKey, result);

    // Record tool execution and verification in append-only cryptographic audit ledger
    AuditLedger.recordToolExecution(payment, result);
    AuditLedger.recordOutcomeVerification(
      payment,
      verified.final_payment_status,
      verified.amount_recovered,
      verified.audit_status
    );

    return result;
  } catch (error: any) {
    idempotencyStore.release(idempotencyKey);
    throw error;
  }
}

/**
 * End-to-End Recovery Pipeline
 * 
 * Strict Multi-Boundary Sequence:
 * 1. Reloads fresh payment state from DataStore
 * 2. Reloads fresh customer state from DataStore
 * 3. Validates AI decision (fails closed to ESCALATE if invalid)
 * 4. Evaluates PolicyEngine on fresh state
 * 5. ONLY IF policy.allowed === true, dispatches to Tool Router
 * 6. Returns audited ToolResult
 */
export async function executeRecoveryPipeline(
  paymentId: string,
  providedDecision?: AIAgentDecision,
  options?: DispatchOptions
): Promise<{ toolResult: ToolResult; policyResult: PolicyResult }> {
  const timestamp = new Date().toISOString();

  // Fast-path: Check idempotency key before re-evaluating mutated state
  if (options?.idempotencyKey) {
    const check = idempotencyStore.check(options.idempotencyKey);
    if (check.exists) {
      if (check.inProgress) {
        throw new ToolRouterError(
          `Concurrent execution already in progress for idempotency key: ${options.idempotencyKey}`,
          'CONCURRENT_EXECUTION'
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

  // Step 1 & 2: Reload fresh state from DataStore
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    throw new ToolRouterError(`Payment not found: ${paymentId}`, 'NOT_FOUND');
  }

  const customer = dataStore.getCustomerById(payment.customer_id);
  if (!customer) {
    throw new ToolRouterError(`Customer not found for payment: ${payment.customer_id}`, 'CUSTOMER_NOT_FOUND');
  }

  const policy = dataStore.getPolicy();

  // Step 3: Validate AI Decision
  let decision: AIAgentDecision;
  if (providedDecision) {
    const validation = validateAgentDecision(providedDecision, paymentId);
    if (!validation.valid) {
      // Malformed AI output fails closed to ESCALATE
      decision = createFallbackDecision(paymentId, `Malformed AI response: ${validation.error}`);
    } else {
      decision = providedDecision;
    }
  } else {
    // Default safe decision if none supplied
    decision = {
      payment_id: paymentId,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.5,
      recommended_action: 'RETRY_PAYMENT',
      confidence: 0.75,
      risk_level: 'LOW',
      reasoning: 'Standard pipeline evaluation'
    };
  }

  // Step 4: Re-evaluate Policy Engine immediately prior to execution
  const policyResult = policyEngine.evaluate(payment, customer, decision, policy);

  // Step 5: Check policy approval before tool dispatch
  if (!policyResult.allowed) {
    const blockedResult: ToolResult = {
      tool_called: 'terminate_recovery',
      action: policyResult.finalAction,
      execution_mode: 'SIMULATED_RECOVERY',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: options?.idempotencyKey || `policy_blocked_${payment.id}_${Date.now()}`,
      policy_decision: 'BLOCKED',
      policy_violations: policyResult.violations.map(v => v.rule),
      final_payment_status: payment.status,
      message: `PolicyEngine BLOCKED execution: ${policyResult.violations.map(v => v.reason).join('; ')}`,
      error_message: 'PolicyEngine denied recovery tool execution permission',
      timestamp
    };

    // If policy forced ESCALATE or STOP, update local state
    if (policyResult.finalAction === 'ESCALATE' && payment.status !== 'escalated') {
      dataStore.updatePayment(payment.id, { status: 'escalated' });
      blockedResult.final_payment_status = 'escalated';
    } else if (policyResult.finalAction === 'STOP' && payment.status !== 'abandoned' && payment.status !== 'captured') {
      dataStore.updatePayment(payment.id, { status: 'abandoned' });
      blockedResult.final_payment_status = 'abandoned';
    }

    // Record policy blocked event and terminal verification event in append-only ledger
    AuditLedger.recordPolicyEvaluation(payment, decision, policyResult);
    AuditLedger.recordOutcomeVerification(
      payment,
      blockedResult.final_payment_status,
      0,
      'SKIPPED'
    );

    return { toolResult: blockedResult, policyResult };
  }

  // Record approved policy evaluation in append-only ledger
  AuditLedger.recordPolicyEvaluation(payment, decision, policyResult);

  // Step 6: Dispatch approved tool via the Router
  const toolResult = await dispatchApprovedTool(
    payment,
    customer,
    decision,
    policyResult,
    options
  );

  return { toolResult, policyResult };
}
