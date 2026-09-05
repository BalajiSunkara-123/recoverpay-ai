/**
 * RecoverPay Simulated Recovery Rail
 * Explicitly labeled simulation engine for card re-authorizations, bank switch retries,
 * and state transitions. Deterministic for all demo scenarios and synthetic records.
 */

import { Payment, Customer, ToolResult, PaymentStatus } from '../../src/types/index.ts';

export interface SimulationExecutionResult {
  toolResult: ToolResult;
  updatedPayment: Partial<Payment>;
}

/**
 * Simulates automated payment retry (e.g. re-routing through healthy payment switch / gateway).
 */
export function simulatePaymentRetry(
  payment: Payment,
  customer: Customer,
  idempotencyKey: string
): SimulationExecutionResult {
  const timestamp = new Date().toISOString();
  const nextRecoveryAttempts = payment.recovery_attempts + 1;

  // Check demo scenarios and ground truth recoverable flag
  let recovered = false;
  let finalStatus: PaymentStatus = 'failed';
  let message = '';
  let errorMsg: string | undefined = undefined;

  if (payment.id === 'pay_demo_transient_01') {
    recovered = true;
    finalStatus = 'captured';
    message = 'SIMULATED_RECOVERY: Bank switch retry succeeded. Payment re-authorized and captured.';
  } else if (payment.id === 'pay_demo_persistent_02') {
    recovered = false;
    finalStatus = 'failed';
    errorMsg = 'SIMULATED_RECOVERY: Bank card limit exceeded. Retry rejected by cardholder bank.';
    message = 'SIMULATED_RECOVERY: Retry attempt failed. Recovery attempts incremented.';
  } else if (payment.ground_truth_recoverable === true) {
    recovered = true;
    finalStatus = 'captured';
    message = 'SIMULATED_RECOVERY: Network/switch retry succeeded. Payment re-authorized and captured.';
  } else {
    recovered = false;
    finalStatus = 'failed';
    errorMsg = `SIMULATED_RECOVERY: Issuer bank decline persisted (${payment.failure_code}).`;
    message = 'SIMULATED_RECOVERY: Retry attempt failed. Recovery attempts incremented.';
  }

  const toolResult: ToolResult = {
    tool_called: 'retry_payment',
    action: 'RETRY_PAYMENT',
    execution_mode: 'SIMULATED_RECOVERY',
    success: recovered,
    recovered,
    amount_recovered: recovered ? payment.amount : 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: 'ALLOWED',
    policy_violations: [],
    external_reference_id: `sim_txn_${payment.id}_${nextRecoveryAttempts}`,
    final_payment_status: finalStatus,
    message,
    error_message: errorMsg,
    timestamp
  };

  const updatedPayment: Partial<Payment> = {
    status: finalStatus,
    recovery_attempts: nextRecoveryAttempts,
    attempt_count: payment.attempt_count + 1,
    last_attempt_at: timestamp,
    updated_at: timestamp
  };

  return { toolResult, updatedPayment };
}

/**
 * Simulates sending a customer payment reminder link
 */
export function simulatePaymentReminder(
  payment: Payment,
  customer: Customer,
  idempotencyKey: string,
  customMessage?: string
): SimulationExecutionResult {
  const timestamp = new Date().toISOString();
  const linkId = `sim_plink_${payment.id.replace('pay_', '')}`;
  const paymentLinkUrl = `https://rzp.io/i/sim_${payment.id.replace('pay_', '')}`;

  // IMPORTANT: Generating a payment link does NOT mean payment is recovered!
  // recovered remains false until customer actually pays and webhook confirms capture.
  const toolResult: ToolResult = {
    tool_called: 'send_payment_reminder',
    action: 'SEND_PAYMENT_REMINDER',
    execution_mode: 'SIMULATED_RECOVERY',
    success: true,
    recovered: false, // Invariant: Payment link generated != captured payment
    amount_recovered: 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: 'ALLOWED',
    policy_violations: [],
    external_reference_id: linkId,
    payment_link_url: paymentLinkUrl,
    final_payment_status: payment.status, // Stays 'failed' or current status until paid
    message: `SIMULATED_RECOVERY: Payment link dispatched to ${customer.email}. Awaiting customer settlement.`,
    timestamp
  };

  const updatedPayment: Partial<Payment> = {
    updated_at: timestamp
  };

  return { toolResult, updatedPayment };
}

/**
 * Transitions state to ops escalation (local state machine, zero financial API calls).
 */
export function simulateEscalateToOps(
  payment: Payment,
  reason: string,
  idempotencyKey: string
): SimulationExecutionResult {
  const timestamp = new Date().toISOString();

  const toolResult: ToolResult = {
    tool_called: 'escalate_to_ops',
    action: 'ESCALATE',
    execution_mode: 'SIMULATED_RECOVERY',
    success: true,
    recovered: false,
    amount_recovered: 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: 'ALLOWED',
    policy_violations: [],
    final_payment_status: 'escalated',
    message: `Payment escalated to Human Operations Queue: ${reason}. Zero payment API calls initiated.`,
    timestamp
  };

  const updatedPayment: Partial<Payment> = {
    status: 'escalated',
    updated_at: timestamp
  };

  return { toolResult, updatedPayment };
}

/**
 * Transitions state to terminal shutdown (local state machine, zero financial API calls).
 */
export function simulateTerminateRecovery(
  payment: Payment,
  reason: string,
  idempotencyKey: string
): SimulationExecutionResult {
  const timestamp = new Date().toISOString();

  const toolResult: ToolResult = {
    tool_called: 'terminate_recovery',
    action: 'STOP',
    execution_mode: 'SIMULATED_RECOVERY',
    success: true,
    recovered: false,
    amount_recovered: 0,
    payment_id: payment.id,
    idempotency_key: idempotencyKey,
    policy_decision: 'ALLOWED',
    policy_violations: [],
    final_payment_status: 'abandoned',
    message: `Automated recovery terminated: ${reason}. Payment marked abandoned. Zero payment API calls initiated.`,
    timestamp
  };

  const updatedPayment: Partial<Payment> = {
    status: 'abandoned',
    updated_at: timestamp
  };

  return { toolResult, updatedPayment };
}
