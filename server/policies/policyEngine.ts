/**
 * RecoverPay Deterministic Policy Engine
 * Evaluates proposed AI decisions against independent policy guardrails.
 * Zero trust toward LLM output. Pure function with zero side-effects.
 */

import {
  Payment,
  Customer,
  AIAgentDecision,
  PolicyRules,
  PolicyResult,
  PolicyViolation,
  RuleEvaluation,
  RecoveryAction
} from '../../src/types/index.ts';
import { POLICY_RULES, PolicyRule } from './rules.ts';

export class PolicyEngine {
  private rules: PolicyRule[];

  constructor(customRules: PolicyRule[] = POLICY_RULES) {
    this.rules = customRules;
  }

  /**
   * Evaluate a proposed action against all deterministic policy rules.
   * Runs all rules to produce an exhaustive audit evaluation breakdown.
   */
  public evaluate(
    payment: Payment,
    customer: Customer,
    decision: AIAgentDecision,
    policy: PolicyRules
  ): PolicyResult {
    const evaluatedRules: RuleEvaluation[] = [];
    const violations: PolicyViolation[] = [];

    const originalAction: RecoveryAction = decision?.recommended_action ?? 'ESCALATE';

    // Evaluate every rule independently
    for (const rule of this.rules) {
      const result = rule(payment, customer, decision, policy);
      evaluatedRules.push(result.evaluation);
      if (result.violation) {
        violations.push(result.violation);
      }
    }

    const allowed = violations.length === 0;

    // Determine finalAction based on violations
    let finalAction: RecoveryAction;

    if (allowed) {
      finalAction = originalAction;
    } else {
      // Prioritize forced STOP over ESCALATE
      // (e.g. if payment is already captured or customer opted out, STOP takes precedence)
      const hasStopViolation = violations.some(v => v.forced_action === 'STOP');
      finalAction = hasStopViolation ? 'STOP' : 'ESCALATE';
    }

    return {
      allowed,
      originalAction,
      finalAction,
      violations,
      evaluatedRules,
      evaluatedAt: new Date().toISOString()
    };
  }
}

export const policyEngine = new PolicyEngine();
