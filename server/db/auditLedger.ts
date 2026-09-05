/**
 * RecoverPay Cryptographic Audit Ledger
 * Append-only, tamper-evident SHA-256 hash-chained event store.
 * 
 * Cryptographic Invariants:
 * 1. Genesis event previous_hash = 64 zeros.
 * 2. Every subsequent event has previous_hash === preceding event.current_hash.
 * 3. current_hash is the SHA-256 digest of canonicalized event fields + previous_hash.
 * 4. Modifying, deleting, or reordering any past event immediately invalidates the chain.
 */

import crypto from 'node:crypto';
import {
  AuditEvent,
  Payment,
  PaymentStatus,
  AIAgentDecision,
  PolicyResult,
  ToolResult,
  ExecutionMode,
  RecoveryAction
} from '../../src/types/index.ts';
import { dataStore } from './store.ts';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditChainVerificationResult {
  valid: boolean;
  total_events: number;
  chain_head?: string;
  broken_at_index?: number;
  error?: string;
}

/**
 * Computes deterministic SHA-256 hash for an audit event payload.
 */
export function calculateEventHash(event: Omit<AuditEvent, 'current_hash'>): string {
  const normalizedViolations = (event.policy_violations || []).slice().sort().join(',');
  const normalizedScore = event.recoverability_score !== undefined
    ? Number(event.recoverability_score).toFixed(4)
    : '';
  const normalizedConfidence = event.confidence !== undefined
    ? Number(event.confidence).toFixed(4)
    : '';

  const canonicalPayload = [
    event.event_id,
    event.payment_id,
    event.timestamp,
    event.event_type,
    event.actor,
    event.agent_diagnosis || '',
    normalizedScore,
    normalizedConfidence,
    event.recommended_action || '',
    event.policy_decision,
    normalizedViolations,
    event.tool_called || '',
    event.execution_mode,
    event.tool_result || '',
    Number(event.amount_recovered || 0).toString(),
    event.final_payment_status,
    event.previous_hash
  ].join('|');

  return crypto.createHash('sha256').update(canonicalPayload).digest('hex');
}

/**
 * Validates the cryptographic integrity of an audit event chain from genesis to head.
 */
export function verifyAuditChain(events: AuditEvent[]): AuditChainVerificationResult {
  if (!events || events.length === 0) {
    return {
      valid: true,
      total_events: 0,
      chain_head: GENESIS_HASH
    };
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedPrevHash = i === 0 ? GENESIS_HASH : events[i - 1].current_hash;

    // 1. Verify previous hash chaining
    if (event.previous_hash !== expectedPrevHash) {
      return {
        valid: false,
        total_events: events.length,
        broken_at_index: i,
        error: `Invalid previous_hash at event index ${i} (${event.event_id}). Expected ${expectedPrevHash.slice(0, 16)}..., received ${event.previous_hash.slice(0, 16)}...`
      };
    }

    // 2. Recalculate and verify current hash
    const expectedCurrentHash = calculateEventHash(event);
    if (event.current_hash !== expectedCurrentHash) {
      return {
        valid: false,
        total_events: events.length,
        broken_at_index: i,
        error: `Cryptographic tamper detected at event index ${i} (${event.event_id}). Stored current_hash (${event.current_hash.slice(0, 16)}...) does not match recalculated hash (${expectedCurrentHash.slice(0, 16)}...).`
      };
    }
  }

  return {
    valid: true,
    total_events: events.length,
    chain_head: events[events.length - 1].current_hash
  };
}

export class AuditLedger {
  /**
   * Appends an audit event to the persistent store with SHA-256 hash chaining.
   */
  public static append(
    params: Omit<AuditEvent, 'event_id' | 'timestamp' | 'previous_hash' | 'current_hash'> & {
      event_id?: string;
      timestamp?: string;
    }
  ): AuditEvent {
    const allEvents = dataStore.getAuditEvents();
    const previousHash = allEvents.length > 0 ? allEvents[allEvents.length - 1].current_hash : GENESIS_HASH;
    
    const eventId = params.event_id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const timestamp = params.timestamp || new Date().toISOString();

    const partialEvent = {
      ...params,
      event_id: eventId,
      timestamp,
      previous_hash: previousHash
    };

    const currentHash = calculateEventHash(partialEvent);
    const fullEvent: AuditEvent = {
      ...partialEvent,
      current_hash: currentHash
    };

    dataStore.appendAuditEvent(fullEvent);
    return fullEvent;
  }

  /**
   * Records a deterministic policy evaluation event.
   */
  public static recordPolicyEvaluation(
    payment: Payment,
    decision: AIAgentDecision,
    policyResult: PolicyResult
  ): AuditEvent {
    return AuditLedger.append({
      payment_id: payment.id,
      event_type: 'POLICY_EVAL',
      actor: 'POLICY_ENGINE',
      agent_diagnosis: decision.diagnosis,
      recoverability_score: decision.recoverability_score,
      confidence: decision.confidence,
      recommended_action: decision.recommended_action,
      policy_decision: policyResult.allowed ? 'ALLOWED' : 'BLOCKED',
      policy_violations: policyResult.violations.map(v => v.rule),
      execution_mode: 'SIMULATED_RECOVERY',
      amount_recovered: 0,
      final_payment_status: payment.status
    });
  }

  /**
   * Records an approved or dispatched tool execution attempt.
   */
  public static recordToolExecution(
    payment: Payment,
    toolResult: ToolResult
  ): AuditEvent {
    return AuditLedger.append({
      payment_id: payment.id,
      event_type: 'TOOL_EXECUTION',
      actor: 'TOOL_RUNNER',
      recommended_action: toolResult.action,
      policy_decision: toolResult.policy_decision,
      policy_violations: toolResult.policy_violations,
      tool_called: toolResult.tool_called,
      execution_mode: toolResult.execution_mode,
      tool_result: toolResult.success ? 'SUCCESS' : 'FAILED',
      amount_recovered: toolResult.amount_recovered,
      final_payment_status: toolResult.final_payment_status
    });
  }

  /**
   * Records an authoritative outcome verification certifying financial transition.
   */
  public static recordOutcomeVerification(
    payment: Payment,
    finalStatus: PaymentStatus,
    amountRecovered: number,
    auditStatus: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  ): AuditEvent {
    return AuditLedger.append({
      payment_id: payment.id,
      event_type: 'VERIFICATION',
      actor: 'TOOL_RUNNER',
      policy_decision: 'ALLOWED',
      execution_mode: 'SIMULATED_RECOVERY',
      tool_result: auditStatus,
      amount_recovered: amountRecovered,
      final_payment_status: finalStatus
    });
  }
}
