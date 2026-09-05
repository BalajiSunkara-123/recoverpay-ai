/**
 * RecoverPay Runtime Agent Decision Validation
 * Strict runtime schema enforcement for LLM responses.
 * Fails closed to ESCALATE on any violation, out-of-range value, or mismatch.
 */

import {
  AIAgentDecision,
  AgentDiagnosis,
  RecoveryAction,
  RiskLevel
} from '../../src/types/index.ts';

const VALID_DIAGNOSES: Set<AgentDiagnosis> = new Set([
  'transient_bank_downtime',
  'network_timeout',
  'insufficient_funds',
  'authentication_failure',
  'expired_card',
  'fatal_declined_card'
]);

const VALID_ACTIONS: Set<RecoveryAction> = new Set([
  'RETRY_PAYMENT',
  'SEND_PAYMENT_REMINDER',
  'ESCALATE',
  'STOP'
]);

const VALID_RISK_LEVELS: Set<RiskLevel> = new Set([
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL'
]);

export interface ValidationResult {
  valid: boolean;
  error?: string;
  decision?: AIAgentDecision;
}

/**
 * Validates a parsed raw decision object against strict numeric, enum, and integrity rules.
 * Does NOT silently coerce dangerous or out-of-bounds values.
 */
export function validateAgentDecision(
  raw: any,
  expectedPaymentId: string
): ValidationResult {
  // 1. Basic object check
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      valid: false,
      error: 'Agent response is not a valid JSON object'
    };
  }

  // 2. Payment ID Integrity check
  if (typeof raw.payment_id !== 'string' || !raw.payment_id.trim()) {
    return {
      valid: false,
      error: 'Missing or empty payment_id in agent response'
    };
  }

  if (raw.payment_id.trim() !== expectedPaymentId) {
    return {
      valid: false,
      error: `Payment ID mismatch: expected "${expectedPaymentId}", received "${raw.payment_id}"`
    };
  }

  // 3. Diagnosis enum check
  if (!VALID_DIAGNOSES.has(raw.diagnosis)) {
    return {
      valid: false,
      error: `Invalid diagnosis "${raw.diagnosis}". Allowed: ${Array.from(VALID_DIAGNOSES).join(', ')}`
    };
  }

  // 4. Action enum check
  if (!VALID_ACTIONS.has(raw.recommended_action)) {
    return {
      valid: false,
      error: `Invalid action "${raw.recommended_action}". Allowed: ${Array.from(VALID_ACTIONS).join(', ')}`
    };
  }

  // 5. Recoverability score numeric range check (0.00 <= score <= 1.00)
  if (
    typeof raw.recoverability_score !== 'number' ||
    isNaN(raw.recoverability_score) ||
    !isFinite(raw.recoverability_score)
  ) {
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

  // 6. Confidence numeric range check (0.00 <= confidence <= 1.00)
  if (
    typeof raw.confidence !== 'number' ||
    isNaN(raw.confidence) ||
    !isFinite(raw.confidence)
  ) {
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

  // 7. Risk level check
  if (!VALID_RISK_LEVELS.has(raw.risk_level)) {
    return {
      valid: false,
      error: `Invalid risk_level "${raw.risk_level}". Allowed: ${Array.from(VALID_RISK_LEVELS).join(', ')}`
    };
  }

  // 8. Reasoning check
  if (typeof raw.reasoning !== 'string' || !raw.reasoning.trim()) {
    return {
      valid: false,
      error: 'Missing or empty reasoning in agent response'
    };
  }

  // 9. Customer recovery message consistency check
  let normalizedMessage: string | undefined = undefined;
  if (raw.recommended_action === 'SEND_PAYMENT_REMINDER') {
    if (typeof raw.customer_recovery_message === 'string' && raw.customer_recovery_message.trim()) {
      normalizedMessage = raw.customer_recovery_message.trim();
    } else {
      normalizedMessage = 'Your recent payment could not be completed. Please try again using your secure payment link.';
    }
  } else {
    // For actions other than SEND_PAYMENT_REMINDER, message must be normalized to undefined
    normalizedMessage = undefined;
  }

  const decision: AIAgentDecision = {
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

/**
 * Creates a deterministic, safe fallback decision when Gemini inference is unavailable or invalid.
 * Always routes safely to ESCALATE with zero automated financial execution.
 */
export function createFallbackDecision(
  paymentId: string,
  reason = 'Gemini inference was unavailable. No automated recovery action is authorized.'
): AIAgentDecision {
  return {
    payment_id: paymentId,
    diagnosis: 'network_timeout',
    recoverability_score: 0,
    recommended_action: 'ESCALATE',
    confidence: 0,
    risk_level: 'HIGH',
    reasoning: reason
  };
}
