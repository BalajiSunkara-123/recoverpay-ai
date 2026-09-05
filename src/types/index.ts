/**
 * RecoverPay Shared Type Definitions
 * Strict TypeScript models for payments, customers, policy engine, and audit trail.
 */

export type FailureCategory =
  | 'TRANSIENT_BANK_FAILURE'
  | 'NETWORK_ERROR'
  | 'INSUFFICIENT_FUNDS'
  | 'AUTHENTICATION_FAILURE'
  | 'EXPIRED_CARD'
  | 'FATAL_DECLINE';

export type RecoveryAction =
  | 'RETRY_PAYMENT'
  | 'SEND_PAYMENT_REMINDER'
  | 'ESCALATE'
  | 'STOP';

export type PaymentStatus =
  | 'failed'
  | 'captured'
  | 'created'
  | 'escalated'
  | 'abandoned';

export type GroundTruthOutcome = 'RECOVERED' | 'PERMANENTLY_FAILED';

export interface Customer {
  id: string;
  name: string;
  email: string;
  contact: string;
  lifetime_value: number; // in paise (₹1 = 100 paise)
  previous_success_count: number;
  previous_failure_count: number;
  historical_success_rate: number; // 0.00 to 1.00
  opted_out: boolean; // Customer opted out of automated recovery
  created_at: string; // ISO 8601
}

export interface PaymentGroundTruth {
  ground_truth_recoverable: boolean;
  ground_truth_best_action: RecoveryAction;
  ground_truth_expected_outcome: GroundTruthOutcome;
  ground_truth_reason: string;
}

export interface Payment extends PaymentGroundTruth {
  id: string; // pay_xxxx
  customer_id: string;
  order_id: string;
  amount: number; // in paise
  currency: 'INR';
  status: PaymentStatus;
  failure_category: FailureCategory;
  failure_code: string;
  failure_reason: string;
  attempt_count: number;
  recovery_attempts: number;
  seconds_since_failure: number;
  last_attempt_at: string; // ISO 8601
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * AGENT INPUT CONTEXT
 * STRICT REQUIREMENT: This context MUST NEVER leak any ground-truth fields
 * (ground_truth_recoverable, ground_truth_best_action, ground_truth_expected_outcome, ground_truth_reason).
 */
export interface AgentInputContext {
  payment: {
    id: string;
    amount: number;
    currency: string;
    failure_category: FailureCategory;
    failure_code: string;
    failure_reason: string;
    attempt_count: number;
    recovery_attempts: number;
    seconds_since_failure: number;
    last_attempt_at: string;
  };
  customer: {
    id: string;
    historical_success_rate: number;
    previous_success_count: number;
    previous_failure_count: number;
    opted_out: boolean;
  };
  merchant_policy_context: {
    max_retries: number;
    max_automated_amount: number; // in paise
    min_cooldown_seconds: number;
  };
}

export type AgentDiagnosis =
  | 'transient_bank_downtime'
  | 'network_timeout'
  | 'insufficient_funds'
  | 'authentication_failure'
  | 'expired_card'
  | 'fatal_declined_card';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AIAgentDecision {
  payment_id: string;
  diagnosis: AgentDiagnosis;
  recoverability_score: number; // 0.00 to 1.00
  recommended_action: RecoveryAction;
  confidence: number; // 0.00 to 1.00
  risk_level: RiskLevel;
  reasoning: string;
  customer_recovery_message?: string;
}

export interface AgentResult {
  success: boolean;
  fallback: boolean;
  decision: AIAgentDecision;
  error?: string;
}

export interface PolicyRules {
  id: string;
  max_retries: number;
  max_automated_recovery_amount: number; // in paise (e.g. 5000000 = ₹50,000)
  min_retry_cooldown_seconds: number; // e.g. 900 seconds (15 min)
  do_not_retry_after_success: boolean;
  do_not_retry_if_customer_opted_out: boolean;
  low_confidence_threshold: number; // e.g. 0.60
}

export interface PolicyViolation {
  rule: string;
  reason: string;
  forced_action: RecoveryAction;
}

export interface RuleEvaluation {
  rule: string;
  passed: boolean;
  reason: string;
}

export interface PolicyResult {
  allowed: boolean;
  originalAction: RecoveryAction;
  finalAction: RecoveryAction;
  violations: PolicyViolation[];
  evaluatedRules: RuleEvaluation[];
  evaluatedAt: string;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: RecoveryAction;
  violations: string[];
  forced_action?: RecoveryAction;
  evaluated_at: string;
}

export type ExecutionMode = 'RAZORPAY_TEST_API' | 'SIMULATED_RECOVERY';

export type ToolName =
  | 'retry_payment'
  | 'send_payment_reminder'
  | 'escalate_to_ops'
  | 'terminate_recovery';

export interface ToolResult {
  tool_called: ToolName;
  action: RecoveryAction;
  execution_mode: ExecutionMode;
  success: boolean;
  recovered: boolean;
  amount_recovered: number; // in paise
  payment_id: string;
  idempotency_key: string;
  policy_decision: 'ALLOWED' | 'BLOCKED';
  policy_violations: string[];
  external_reference_id?: string;
  payment_link_url?: string;
  final_payment_status: PaymentStatus;
  message: string;
  error_message?: string;
  idempotent_replay?: boolean;
  timestamp: string;
}

export interface RecoveryExecutionRequest {
  payment_id: string;
  idempotency_key?: string;
  custom_decision?: AIAgentDecision;
  force_mode?: ExecutionMode;
}

export interface AuditEvent {
  event_id: string;
  payment_id: string;
  timestamp: string; // ISO 8601
  event_type: 'DIAGNOSIS' | 'POLICY_EVAL' | 'TOOL_EXECUTION' | 'VERIFICATION';
  actor: 'GEMINI_AGENT' | 'POLICY_ENGINE' | 'TOOL_RUNNER' | 'OPERATOR';
  agent_diagnosis?: string;
  recoverability_score?: number;
  confidence?: number;
  recommended_action?: RecoveryAction;
  policy_decision: 'ALLOWED' | 'BLOCKED';
  policy_violations?: string[];
  tool_called?: string;
  execution_mode: ExecutionMode;
  tool_result?: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  amount_recovered: number; // in paise
  final_payment_status: PaymentStatus;
  previous_hash: string;
  current_hash: string;
}

export interface DatasetStats {
  total_records: number;
  category_distribution: Record<FailureCategory, number>;
  edge_cases: {
    opted_out_count: number;
    high_value_count: number;
    max_retries_count: number;
    cooldown_active_count: number;
  };
  total_failure_amount: number; // in paise
  ground_truth_recoverable_count: number;
  ground_truth_recoverable_amount: number; // in paise
  generated_at: string;
}

export type EvaluationStrategyName = 'NAIVE_RETRY_ALL' | 'DETERMINISTIC_RULES' | 'RECOVERPAY_AI_POLICY';

export interface StrategyMetrics {
  strategy: EvaluationStrategyName;
  label: string;
  total_records: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  false_positive_rate: number;
  recovery_rate: number;
  revenue_recovered_paise: number;
  revenue_recovered_inr: number;
  revenue_at_risk_paise: number;
  revenue_at_risk_inr: number;
  unnecessary_retries: number;
  policy_interceptions: number;
  escalations: number;
  tool_executions: number;
  safety_violations: number;
}

export interface ComparisonRow {
  metric: string;
  label: string;
  description: string;
  naive: string | number;
  deterministic: string | number;
  recoverpay: string | number;
  advantage: 'recoverpay' | 'deterministic' | 'naive' | 'neutral';
}

export interface EvaluationComparisonResponse {
  success: boolean;
  timestamp: string;
  dataset_size: number;
  strategies: {
    naive_retry_all: StrategyMetrics;
    deterministic_rules: StrategyMetrics;
    recoverpay_ai_policy: StrategyMetrics;
  };
  metrics_comparison: ComparisonRow[];
  ground_truth_isolation_verified: boolean;
}
