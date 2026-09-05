/**
 * RecoverPay Recovery Execution Routes
 * 
 * SOLE EXTERNAL INTERFACE FOR TRIGGERING RECOVERY ACTIONS.
 * 
 * Architecture:
 * - Strictly decoupled from diagnosis (POST /api/agent/diagnose has zero side-effects).
 * - Always reloads current payment and customer state from DataStore.
 * - Always re-evaluates the Policy Engine before tool dispatch.
 * - Dispatches via Bounded Tool Router.
 */

import { Router, Request, Response } from 'express';
import { dataStore } from '../db/store.ts';
import { executeRecoveryPipeline, ToolRouterError } from '../tools/toolRegistry.ts';
import { AIAgentDecision } from '../../src/types/index.ts';

export const recoveryRouter = Router();

/**
 * POST /api/recovery/:paymentId/execute
 * Executes the full bounded recovery pipeline for a payment.
 */
recoveryRouter.post('/:paymentId/execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { paymentId } = req.params;
    const { decision, idempotency_key, preferred_mode, reminder_message } = req.body;

    const result = await executeRecoveryPipeline(
      paymentId,
      decision,
      {
        idempotencyKey: idempotency_key,
        preferredMode: preferred_mode,
        reminderMessage: reminder_message
      }
    );

    res.json({
      success: result.toolResult.success,
      toolResult: result.toolResult,
      policyResult: result.policyResult
    });
  } catch (err: any) {
    if (err instanceof ToolRouterError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      res.status(status).json({
        success: false,
        error: err.message,
        code: err.code
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: err.message || 'Internal Server Error'
    });
  }
});

/**
 * POST /api/recovery/:paymentId/remind
 * Explicitly triggers a payment reminder link for a payment.
 * Still strictly subject to PolicyEngine approval!
 */
recoveryRouter.post('/:paymentId/remind', async (req: Request, res: Response): Promise<void> => {
  try {
    const { paymentId } = req.params;
    const { custom_message, preferred_mode, idempotency_key } = req.body;

    const payment = dataStore.getPaymentById(paymentId);
    if (!payment) {
      res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
      return;
    }

    const customer = dataStore.getCustomerById(payment.customer_id);
    if (!customer) {
      res.status(404).json({ success: false, error: `Customer not found: ${payment.customer_id}` });
      return;
    }

    const decision: AIAgentDecision = {
      payment_id: paymentId,
      diagnosis: 'transient_bank_downtime',
      recoverability_score: 0.8,
      recommended_action: 'SEND_PAYMENT_REMINDER',
      confidence: 0.9,
      risk_level: 'LOW',
      reasoning: 'Operator or automated pipeline initiated payment reminder link',
      customer_recovery_message: custom_message
    };

    const result = await executeRecoveryPipeline(paymentId, decision, {
      idempotencyKey: idempotency_key,
      preferredMode: preferred_mode,
      reminderMessage: custom_message
    });

    res.json({
      success: result.toolResult.success,
      toolResult: result.toolResult,
      policyResult: result.policyResult
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Internal Server Error'
    });
  }
});

/**
 * POST /api/recovery/:paymentId/escalate
 * Manually or automatically escalates payment to Human Operations Queue.
 */
recoveryRouter.post('/:paymentId/escalate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { paymentId } = req.params;
    const { reason, idempotency_key } = req.body;

    const payment = dataStore.getPaymentById(paymentId);
    if (!payment) {
      res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
      return;
    }

    const decision: AIAgentDecision = {
      payment_id: paymentId,
      diagnosis: 'fatal_declined_card',
      recoverability_score: 0.0,
      recommended_action: 'ESCALATE',
      confidence: 1.0,
      risk_level: 'MEDIUM',
      reasoning: reason || 'Operations escalation requested'
    };

    const result = await executeRecoveryPipeline(paymentId, decision, {
      idempotencyKey: idempotency_key
    });

    res.json({
      success: result.toolResult.success,
      toolResult: result.toolResult,
      policyResult: result.policyResult
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Internal Server Error'
    });
  }
});

/**
 * GET /api/recovery/:paymentId/status
 * Fetches current payment status, customer context, and policy rules.
 */
recoveryRouter.get('/:paymentId/status', (req: Request, res: Response): void => {
  const { paymentId } = req.params;

  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
    return;
  }

  const customer = dataStore.getCustomerById(payment.customer_id);
  const policy = dataStore.getPolicy();
  const auditEvents = dataStore.getAuditEvents(paymentId);

  res.json({
    success: true,
    payment,
    customer,
    policy,
    auditEvents
  });
});
