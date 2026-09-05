/**
 * RecoverPay Dashboard & Metrics Routes
 * Computes live operational metrics and recovery funnel directly from DataStore state.
 * Never invents or hard-codes metrics.
 */

import { Router, Request, Response } from 'express';
import { dataStore } from '../db/store.ts';
import { Payment, AuditEvent } from '../../src/types/index.ts';

export const dashboardRouter = Router();

export interface DashboardMetricsResponse {
  success: boolean;
  timestamp: string;
  metrics: {
    total_failed_payments: number;
    recoverable_payments: number;
    total_captured_payments: number;
    total_escalated_payments: number;
    total_abandoned_payments: number;
    recovery_rate_percent: number;
    revenue_at_risk_paise: number;
    revenue_at_risk_inr: number;
    revenue_recovered_paise: number;
    revenue_recovered_inr: number;
    policy_block_rate_percent: number;
    escalation_rate_percent: number;
    unnecessary_retry_rate_percent: number;
    execution_breakdown: {
      razorpay_test_api: number;
      simulated_recovery: number;
      ops_escalated: number;
      recovery_terminated: number;
    };
  };
  funnel: {
    telemetry_failed: number;
    ai_diagnosed: number;
    policy_evaluated: number;
    policy_approved: number;
    policy_blocked: number;
    tool_executed: number;
    outcome_verified: number;
    recovered: number;
    escalated: number;
    terminated: number;
  };
}

/**
 * GET /api/dashboard/metrics
 * Computes live dashboard indicators from current DataStore state & audit log.
 */
dashboardRouter.get('/metrics', (_req: Request, res: Response): void => {
  const allPayments = dataStore.getAllPayments();
  const allDemoScenarios = dataStore.getAllDemoScenarios();
  
  // Combine all payments (regular dataset + demo fixtures that have been loaded/updated)
  const combinedPaymentsMap = new Map<string, Payment>();
  for (const p of allPayments) {
    combinedPaymentsMap.set(p.id, p);
  }
  for (const demoKey of Object.keys(allDemoScenarios)) {
    const demoPay = allDemoScenarios[demoKey].payment;
    combinedPaymentsMap.set(demoPay.id, demoPay);
  }

  const payments = Array.from(combinedPaymentsMap.values());
  const auditEvents = dataStore.getAuditEvents();

  // Metrics calculations
  let totalPayments = payments.length;
  let recoverableCount = 0;
  let capturedCount = 0;
  let escalatedCount = 0;
  let abandonedCount = 0;
  let revenueAtRiskPaise = 0;
  let revenueRecoveredPaise = 0;

  for (const p of payments) {
    const isRecoverable = p.ground_truth_recoverable ||
      p.failure_category === 'TRANSIENT_BANK_FAILURE' ||
      p.failure_category === 'NETWORK_ERROR';

    if (isRecoverable) {
      recoverableCount++;
    }

    if (p.status === 'captured') {
      capturedCount++;
      revenueRecoveredPaise += p.amount;
    } else {
      revenueAtRiskPaise += p.amount;
      if (p.status === 'escalated') {
        escalatedCount++;
      } else if (p.status === 'abandoned') {
        abandonedCount++;
      }
    }
  }

  // Audit event analytics for policy blocks, executions, etc.
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
    if (evt.event_type === 'POLICY_EVAL') {
      policyEvaluations++;
      if (evt.policy_decision === 'ALLOWED') {
        policyAllowedCount++;
      } else {
        policyBlockedCount++;
      }
    } else if (evt.event_type === 'TOOL_EXECUTION') {
      toolExecutedCount++;
      const mode = evt.execution_mode;
      const tool = evt.tool_called;
      if (mode === 'RAZORPAY_TEST_API') {
        razorpayTestApiCount++;
      } else if (mode === 'SIMULATED_RECOVERY') {
        simulatedRecoveryCount++;
      }
      if (tool === 'escalate_to_ops') {
        opsEscalatedCount++;
      } else if (tool === 'terminate_recovery') {
        recoveryTerminatedCount++;
      }

      // Check if this was an unnecessary retry on an unrecoverable failure
      const targetPay = combinedPaymentsMap.get(evt.payment_id);
      if (targetPay && !targetPay.ground_truth_recoverable && tool === 'retry_payment') {
        unnecessaryRetryCount++;
      }
    } else if (evt.event_type === 'VERIFICATION') {
      outcomeVerifiedCount++;
    }
  }

  // Funnel numbers
  const aiDiagnosedCount = new Set(
    auditEvents.filter(e => e.event_type === 'DIAGNOSIS').map(e => e.payment_id)
  ).size;

  const policyEvaluatedPaymentsCount = new Set(
    auditEvents.filter(e => e.event_type === 'POLICY_EVAL').map(e => e.payment_id)
  ).size;

  const policyBlockRate = policyEvaluations > 0
    ? (policyBlockedCount / policyEvaluations) * 100
    : 0;

  const recoveryRate = recoverableCount > 0
    ? (capturedCount / recoverableCount) * 100
    : 0;

  const escalationRate = totalPayments > 0
    ? (escalatedCount / totalPayments) * 100
    : 0;

  const unnecessaryRetryRate = totalPayments > 0
    ? (unnecessaryRetryCount / totalPayments) * 100
    : 0;

  const response: DashboardMetricsResponse = {
    success: true,
    timestamp: new Date().toISOString(),
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
