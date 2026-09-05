/**
 * RecoverPay API Client
 * Centralized HTTP client communicating with backend endpoints.
 * Never invents mock data or executes frontend-side policy bypasses.
 */

import {
  Payment,
  Customer,
  PolicyRules,
  AuditEvent,
  AIAgentDecision,
  PolicyResult,
  ToolResult,
  EvaluationComparisonResponse
} from '../types/index.ts';

export interface DashboardMetrics {
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
}

export interface RecoveryFunnelData {
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
}

export interface PaymentListItem {
  payment: Payment;
  customer: Customer | null;
  auditCount: number;
  latestEvent: AuditEvent | null;
  id?: string;
  customer_name?: string;
  customer_id?: string;
  amount?: number;
  failure_reason?: string;
  error_code?: string;
  recovery_attempts?: number;
  status?: string;
  last_agent_action?: string;
  last_agent_confidence?: number;
  last_policy_status?: string;
  last_tool_name?: string;
}

export interface PaymentListResponse {
  success: boolean;
  total: number;
  count: number;
  offset: number;
  limit: number;
  payments: PaymentListItem[];
}

export interface PaymentDetailResponse {
  success: boolean;
  payment: Payment;
  customer: Customer | null;
  policy: PolicyRules;
  auditEvents: AuditEvent[];
  latestDecision?: AIAgentDecision;
  latestPolicyResult?: PolicyResult;
  latestToolResult?: ToolResult;
}

export interface DemoTraceResponse {
  success: boolean;
  scenarioId: string;
  scenarioTitle: string;
  scenarioDescription: string;
  expectedBehavior: string;
  payment: Payment;
  customer: Customer;
  telemetry: {
    failure_code: string;
    failure_category: string;
    amount_inr: number;
    opted_out: boolean;
    recovery_attempts: number;
    seconds_since_failure: number;
  };
  aiDecision: AIAgentDecision;
  validation: {
    valid: boolean;
    error?: string;
  };
  policyResult: PolicyResult;
  toolResult: ToolResult;
  outcomeVerification: {
    verified: boolean;
    final_status: string;
    recovered: boolean;
    amount_recovered_inr: number;
    message: string;
  };
  auditTrail: Array<{
    timestamp: string;
    event_type: string;
    actor: string;
    result: string;
  }>;
}

export async function fetchDashboardMetrics(): Promise<{
  metrics: DashboardMetrics;
  funnel: RecoveryFunnelData;
}> {
  const res = await fetch('/api/dashboard/metrics');
  if (!res.ok) {
    throw new Error(`Failed to fetch metrics: ${res.statusText}`);
  }
  const data = await res.json();
  return {
    metrics: data.metrics,
    funnel: data.funnel
  };
}

export async function fetchPayments(params: {
  filter?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sort?: string;
}): Promise<PaymentListResponse> {
  const query = new URLSearchParams();
  if (params.filter) query.set('filter', params.filter);
  if (params.search) query.set('search', params.search);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined) query.set('offset', String(params.offset));
  if (params.sort) query.set('sort', params.sort);

  const res = await fetch(`/api/payments?${query.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch payments: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchPaymentDetail(paymentId: string): Promise<PaymentDetailResponse> {
  const res = await fetch(`/api/payments/${paymentId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch payment details: ${res.statusText}`);
  }
  return res.json();
}

export async function runDemoScenario(scenarioId: string): Promise<DemoTraceResponse> {
  const res = await fetch(`/api/demo/scenario/${scenarioId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Demo execution failed: ${res.statusText}`);
  }
  return res.json();
}

export async function runAgentDiagnosis(paymentId: string): Promise<AIAgentDecision> {
  const res = await fetch('/api/agent/diagnose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_id: paymentId })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Agent diagnosis failed: ${res.statusText}`);
  }
  const data = await res.json();
  return data.decision;
}

export async function evaluatePolicy(paymentId: string, decision: AIAgentDecision): Promise<PolicyResult> {
  const res = await fetch('/api/policy/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId, decision })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Policy evaluation failed: ${res.statusText}`);
  }
  const data = await res.json();
  return data.policyResult;
}

export async function executeRecovery(
  paymentId: string,
  options?: {
    custom_decision?: AIAgentDecision;
    force_mode?: string;
  }
): Promise<{
  success: boolean;
  paymentId: string;
  toolResult: ToolResult;
  policyResult: PolicyResult;
}> {
  const res = await fetch(`/api/recovery/${paymentId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      custom_decision: options?.custom_decision,
      force_mode: options?.force_mode,
      idempotency_key: `console_exec_${paymentId}_${Date.now()}`
    })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Recovery execution failed: ${res.statusText}`);
  }
  return res.json();
}

export async function resetDataset(): Promise<void> {
  const res = await fetch('/api/dataset/reset', { method: 'POST' });
  if (!res.ok) {
    throw new Error('Failed to reset dataset');
  }
}

export async function fetchEvaluationComparison(): Promise<EvaluationComparisonResponse> {
  const res = await fetch('/api/evaluation/compare');
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Evaluation fetch failed: ${res.statusText}`);
  }
  return res.json();
}

export interface JudgeDemoResponse {
  success: boolean;
  payment: Payment;
  customer: Customer;
  sanitizedContext: any;
  quarantinedGroundTruth: {
    ground_truth_recoverable?: boolean;
    ground_truth_best_action?: string;
    ground_truth_expected_outcome?: string;
    ground_truth_reason?: string;
  };
  diagnosisSource: 'GEMINI_3.8_FLASH' | 'DETERMINISTIC_FALLBACK';
  fallbackReason?: string;
  aiDecision: AIAgentDecision;
  validation: { valid: boolean; error?: string };
  policyResult: PolicyResult;
  toolResult: ToolResult;
  outcomeVerification: {
    verified: boolean;
    tool_execution_status: string;
    payment_status: string;
    recovered: boolean;
    amount_recovered_inr: number;
    invariant_rule: string;
    message: string;
  };
  auditTrail: AuditEvent[];
  benchmarks: {
    dataset_size: number;
    naive: {
      recovery_rate: string;
      precision: string;
      safety_violations: number;
      false_positives: number;
      tool_executions: number;
    };
    deterministic: {
      recovery_rate: string;
      precision: string;
      safety_violations: number;
      false_positives: number;
      missed_recoveries: number;
    };
    recoverpay: {
      recovery_rate: string;
      precision: string;
      safety_violations: number;
      false_positives: number;
      policy_blocks: number;
      ops_escalations: number;
      f1_score: string;
    };
  };
}

export interface SafetyBlockResponse {
  success: boolean;
  payment: Payment;
  customer: Customer;
  sanitizedContext: any;
  aiDecision: AIAgentDecision;
  policyResult: PolicyResult;
  toolResult: ToolResult;
  outcomeVerification: {
    verified: boolean;
    tool_execution_status: string;
    payment_status: string;
    recovered: boolean;
    amount_recovered_inr: number;
    message: string;
  };
  auditTrail: AuditEvent[];
}

export async function runJudgeWorkflow(): Promise<JudgeDemoResponse> {
  const res = await fetch('/api/demo/judge-workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Judge workflow failed: ${res.statusText}`);
  }
  return res.json();
}

export async function runSafetyBlock(): Promise<SafetyBlockResponse> {
  const res = await fetch('/api/demo/safety-block', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Safety block execution failed: ${res.statusText}`);
  }
  return res.json();
}

