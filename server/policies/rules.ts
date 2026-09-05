/**
 * RecoverPay Deterministic Policy Rules
 * 8 Independent, composable, and unit-testable guardrails.
 * Zero trust toward LLM output. Zero financial execution side-effects.
 */

import {
  Payment,
  Customer,
  AIAgentDecision,
  PolicyRules,
  PolicyViolation,
  RuleEvaluation,
  RecoveryAction
} from '../../src/types/index.ts';

export interface RuleEvaluationResult {
  evaluation: RuleEvaluation;
  violation: PolicyViolation | null;
}

export type PolicyRule = (
  payment: Payment,
  customer: Customer,
  decision: AIAgentDecision,
  policy: PolicyRules
) => RuleEvaluationResult;

const VALID_ACTIONS: Set<string> = new Set([
  'RETRY_PAYMENT',
  'SEND_PAYMENT_REMINDER',
  'ESCALATE',
  'STOP'
]);

/**
 * RULE 8: MALFORMED_OUTPUT
 * Validates that the decision object is a well-formed object with non-empty fields.
 */
export const malformedOutputRule: PolicyRule = (
  _payment,
  _customer,
  decision
): RuleEvaluationResult => {
  const ruleName = 'MALFORMED_OUTPUT';

  if (
    !decision ||
    typeof decision !== 'object' ||
    !decision.payment_id ||
    typeof decision.confidence !== 'number' ||
    isNaN(decision.confidence) ||
    !isFinite(decision.confidence) ||
    decision.confidence < 0 ||
    decision.confidence > 1 ||
    typeof decision.recoverability_score !== 'number' ||
    isNaN(decision.recoverability_score) ||
    !isFinite(decision.recoverability_score) ||
    decision.recoverability_score < 0 ||
    decision.recoverability_score > 1 ||
    !decision.recommended_action
  ) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: 'AIAgentDecision is malformed, missing required fields, or contains invalid numerical values'
      },
      violation: {
        rule: ruleName,
        reason: 'AIAgentDecision is malformed, missing required fields, or contains invalid numerical values',
        forced_action: 'ESCALATE'
      }
    };
  }

  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: 'Agent decision payload is syntactically well-formed'
    },
    violation: null
  };
};

/**
 * RULE 7: INVALID_ACTION
 * Rejects any recommended action outside the 4 allowed bounded verbs.
 */
export const invalidActionRule: PolicyRule = (
  _payment,
  _customer,
  decision
): RuleEvaluationResult => {
  const ruleName = 'INVALID_ACTION';

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
        forced_action: 'ESCALATE'
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

/**
 * RULE 1: ALREADY_SUCCESSFUL
 * If payment is already captured, refuse any automated retry/reminder to prevent double charging.
 */
export const alreadySuccessfulRule: PolicyRule = (
  payment
): RuleEvaluationResult => {
  const ruleName = 'ALREADY_SUCCESSFUL';

  if (payment.status === 'captured') {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Payment ${payment.id} status is already "captured". Duplicate recovery strictly blocked.`
      },
      violation: {
        rule: ruleName,
        reason: `Payment ${payment.id} status is already "captured". Duplicate recovery strictly blocked.`,
        forced_action: 'STOP'
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

/**
 * RULE 2: CUSTOMER_OPTED_OUT
 * If customer opted out, block automated outreach/retries.
 */
export const customerOptedOutRule: PolicyRule = (
  _payment,
  customer,
  decision,
  policy
): RuleEvaluationResult => {
  const ruleName = 'CUSTOMER_OPTED_OUT';

  if (
    policy.do_not_retry_if_customer_opted_out &&
    customer.opted_out &&
    (decision.recommended_action === 'RETRY_PAYMENT' ||
      decision.recommended_action === 'SEND_PAYMENT_REMINDER')
  ) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Customer ${customer.id} has opted out of automated outreach and retries`
      },
      violation: {
        rule: ruleName,
        reason: `Customer ${customer.id} has opted out of automated outreach and retries`,
        forced_action: 'STOP'
      }
    };
  }

  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: customer.opted_out
        ? 'Customer opted out, but proposed action is non-automated (ESCALATE or STOP)'
        : 'Customer has not opted out'
    },
    violation: null
  };
};

/**
 * RULE 3: MAX_RETRIES_EXCEEDED
 * If action is RETRY_PAYMENT and recovery_attempts >= max_retries, block further retries.
 */
export const maxRetriesRule: PolicyRule = (
  payment,
  _customer,
  decision,
  policy
): RuleEvaluationResult => {
  const ruleName = 'MAX_RETRIES_EXCEEDED';

  if (
    decision.recommended_action === 'RETRY_PAYMENT' &&
    payment.recovery_attempts >= policy.max_retries
  ) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Recovery attempts ${payment.recovery_attempts} >= maximum allowed limit ${policy.max_retries}`
      },
      violation: {
        rule: ruleName,
        reason: `Recovery attempts ${payment.recovery_attempts} >= maximum allowed limit ${policy.max_retries}`,
        forced_action: 'ESCALATE'
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

/**
 * RULE 4: COOLDOWN_ACTIVE
 * If action is RETRY_PAYMENT and seconds_since_failure < min_retry_cooldown_seconds, block.
 */
export const cooldownRule: PolicyRule = (
  payment,
  _customer,
  decision,
  policy
): RuleEvaluationResult => {
  const ruleName = 'COOLDOWN_ACTIVE';

  if (
    decision.recommended_action === 'RETRY_PAYMENT' &&
    payment.seconds_since_failure < policy.min_retry_cooldown_seconds
  ) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Cooldown active: ${payment.seconds_since_failure}s elapsed < required ${policy.min_retry_cooldown_seconds}s`
      },
      violation: {
        rule: ruleName,
        reason: `Cooldown active: ${payment.seconds_since_failure}s elapsed < required ${policy.min_retry_cooldown_seconds}s`,
        forced_action: 'ESCALATE'
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

/**
 * RULE 5: AMOUNT_EXCEEDS_CAP
 * If automated financial action (RETRY_PAYMENT) exceeds merchant limit, block and escalate.
 */
export const amountCapRule: PolicyRule = (
  payment,
  _customer,
  decision,
  policy
): RuleEvaluationResult => {
  const ruleName = 'AMOUNT_EXCEEDS_CAP';

  if (
    decision.recommended_action === 'RETRY_PAYMENT' &&
    payment.amount > policy.max_automated_recovery_amount
  ) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Payment amount ₹${(payment.amount / 100).toLocaleString('en-IN')} exceeds maximum automated recovery cap of ₹${(policy.max_automated_recovery_amount / 100).toLocaleString('en-IN')}`
      },
      violation: {
        rule: ruleName,
        reason: `Payment amount ₹${(payment.amount / 100).toLocaleString('en-IN')} exceeds maximum automated recovery cap of ₹${(policy.max_automated_recovery_amount / 100).toLocaleString('en-IN')}`,
        forced_action: 'ESCALATE'
      }
    };
  }

  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: `Payment amount ₹${(payment.amount / 100).toLocaleString('en-IN')} is within automated cap of ₹${(policy.max_automated_recovery_amount / 100).toLocaleString('en-IN')}`
    },
    violation: null
  };
};

/**
 * RULE 6: LOW_CONFIDENCE
 * If Gemini confidence < configured threshold, block consequential automated actions
 * (RETRY_PAYMENT, SEND_PAYMENT_REMINDER) and route to human ops (ESCALATE).
 * Non-automated safety actions (STOP, ESCALATE) are NOT blocked by low confidence.
 */
export const lowConfidenceRule: PolicyRule = (
  _payment,
  _customer,
  decision,
  policy
): RuleEvaluationResult => {
  const ruleName = 'LOW_CONFIDENCE';

  const isAutomatedAction =
    decision?.recommended_action === 'RETRY_PAYMENT' ||
    decision?.recommended_action === 'SEND_PAYMENT_REMINDER';

  if (
    isAutomatedAction &&
    typeof decision?.confidence === 'number' &&
    decision.confidence < policy.low_confidence_threshold
  ) {
    return {
      evaluation: {
        rule: ruleName,
        passed: false,
        reason: `Agent confidence ${decision.confidence.toFixed(2)} < configured threshold ${policy.low_confidence_threshold.toFixed(2)} for automated action "${decision.recommended_action}"`
      },
      violation: {
        rule: ruleName,
        reason: `Agent confidence ${decision.confidence.toFixed(2)} < configured threshold ${policy.low_confidence_threshold.toFixed(2)} for automated action "${decision.recommended_action}"`,
        forced_action: 'ESCALATE'
      }
    };
  }

  return {
    evaluation: {
      rule: ruleName,
      passed: true,
      reason: !isAutomatedAction
        ? `Proposed action "${decision?.recommended_action}" is non-automated (STOP/ESCALATE), low-confidence restriction does not apply`
        : `Agent confidence (${decision?.confidence?.toFixed(2)}) meets or exceeds threshold (${policy.low_confidence_threshold.toFixed(2)})`
    },
    violation: null
  };
};

/**
 * Complete ordered list of policy rules evaluated sequentially.
 * Every rule runs to capture a full audit breakdown of passes and failures.
 */
export const POLICY_RULES: PolicyRule[] = [
  malformedOutputRule,
  invalidActionRule,
  alreadySuccessfulRule,
  customerOptedOutRule,
  maxRetriesRule,
  cooldownRule,
  amountCapRule,
  lowConfidenceRule
];
