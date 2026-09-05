/**
 * RecoverPay Execution Outcome Verification Layer
 * Authoritatively certifies the financial state transition of a recovery action.
 * 
 * Strict Invariants:
 * - "TEST API SUCCESS != PAYMENT RECOVERY"
 * - Creating a payment link or order NEVER marks payment as captured/recovered.
 * - Recovered payments must transition to 'captured' with amount_recovered === payment.amount.
 * - Failed retries remain 'failed' with amount_recovered === 0.
 */

import { Payment, PaymentStatus, ToolResult } from '../../src/types/index.ts';

export interface VerifiedOutcome {
  verified: boolean;
  final_payment_status: PaymentStatus;
  recovered: boolean;
  amount_recovered: number;
  audit_status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  verification_notes: string;
}

export function verifyExecutionOutcome(payment: Payment, result: ToolResult): VerifiedOutcome {
  // Rule 1: Action was blocked by policy
  if (result.policy_decision === 'BLOCKED') {
    return {
      verified: true,
      final_payment_status: payment.status,
      recovered: false,
      amount_recovered: 0,
      audit_status: 'SKIPPED',
      verification_notes: `Zero tool execution: Blocked by Policy Engine (${result.policy_violations.join(', ')})`
    };
  }

  // Rule 2: Escalation to human ops
  if (result.action === 'ESCALATE' || result.tool_called === 'escalate_to_ops') {
    return {
      verified: true,
      final_payment_status: 'escalated',
      recovered: false,
      amount_recovered: 0,
      audit_status: 'SUCCESS',
      verification_notes: 'Verified transition to Human Operations queue. Zero financial execution.'
    };
  }

  // Rule 3: Terminal recovery shutdown
  if (result.action === 'STOP' || result.tool_called === 'terminate_recovery') {
    return {
      verified: true,
      final_payment_status: 'abandoned',
      recovered: false,
      amount_recovered: 0,
      audit_status: 'SUCCESS',
      verification_notes: 'Verified terminal stop transition. Automated recovery halted.'
    };
  }

  // Rule 4: Payment Reminder link generated (Test mode or simulation)
  if (result.tool_called === 'send_payment_reminder') {
    // Payment link generation is NOT a captured payment
    return {
      verified: true,
      final_payment_status: payment.status, // remains 'failed'
      recovered: false,
      amount_recovered: 0,
      audit_status: result.success ? 'SUCCESS' : 'FAILED',
      verification_notes: result.success
        ? `Payment reminder link issued (${result.external_reference_id || 'link'}). Awaiting customer authorization.`
        : `Payment reminder failed: ${result.error_message || result.message}`
    };
  }

  // Rule 5: Payment Retry execution (Simulation or test rail)
  if (result.tool_called === 'retry_payment') {
    if (result.recovered === true && result.success === true) {
      return {
        verified: true,
        final_payment_status: 'captured',
        recovered: true,
        amount_recovered: payment.amount,
        audit_status: 'SUCCESS',
        verification_notes: `Payment re-authorization verified captured. Recovered ₹${(payment.amount / 100).toLocaleString('en-IN')}.`
      };
    } else {
      return {
        verified: true,
        final_payment_status: 'failed',
        recovered: false,
        amount_recovered: 0,
        audit_status: 'FAILED',
        verification_notes: `Payment retry failed: ${result.error_message || result.message}`
      };
    }
  }

  // Fallback / Unknown tool
  return {
    verified: false,
    final_payment_status: payment.status,
    recovered: false,
    amount_recovered: 0,
    audit_status: 'FAILED',
    verification_notes: `Unrecognized tool outcome: ${result.tool_called}`
  };
}
