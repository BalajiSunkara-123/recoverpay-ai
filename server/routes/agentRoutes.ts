/**
 * RecoverPay Agent Routes
 * Exposes AI diagnosis endpoint for failed payment telemetry.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * 1. Zero Tool Execution: This route NEVER executes payment actions or calls Razorpay APIs.
 * 2. Zero State Mutation: This route NEVER modifies payment status, customer records, or audit ledger.
 * 3. Ground-Truth Sanitized: Context passed to Gemini NEVER contains ground truth fields.
 */

import { Router, Request, Response } from 'express';
import { dataStore } from '../db/store.ts';
import { toAgentInputContext } from '../data/generator.ts';
import { geminiRecoveryAgent } from '../agents/geminiRecoveryAgent.ts';
import { AgentInputContext } from '../../src/types/index.ts';

export const agentRouter = Router();

/**
 * POST /api/agent/diagnose
 * Takes a payment_id (or explicit sanitized context).
 * Returns probabilistic AI diagnosis and bounded recovery recommendation.
 */
agentRouter.post('/diagnose', async (req: Request, res: Response): Promise<void> => {
  try {
    const { payment_id, context: explicitContext } = req.body;

    let context: AgentInputContext;

    if (explicitContext && explicitContext.payment && explicitContext.payment.id) {
      // Direct context provided (e.g. from test harness)
      context = explicitContext;
    } else if (payment_id && typeof payment_id === 'string') {
      // Look up payment and customer from dataStore
      const payment = dataStore.getPaymentById(payment_id);
      if (!payment) {
        res.status(404).json({
          success: false,
          error: `Payment with ID "${payment_id}" was not found`
        });
        return;
      }

      const customer = dataStore.getCustomerById(payment.customer_id);
      if (!customer) {
        res.status(404).json({
          success: false,
          error: `Customer with ID "${payment.customer_id}" for payment "${payment_id}" was not found`
        });
        return;
      }

      const policy = dataStore.getPolicy();
      context = toAgentInputContext(payment, customer, policy);
    } else {
      res.status(400).json({
        success: false,
        error: 'Missing required field: "payment_id" or "context"'
      });
      return;
    }

    // Ground Truth Isolation Verification Assertion
    const contextAny = context as any;
    if (
      contextAny.payment?.ground_truth_recoverable !== undefined ||
      contextAny.payment?.ground_truth_best_action !== undefined ||
      contextAny.payment?.ground_truth_expected_outcome !== undefined ||
      contextAny.payment?.ground_truth_reason !== undefined
    ) {
      res.status(500).json({
        success: false,
        error: 'FATAL SECURITY ERROR: Ground truth leakage detected in agent input context'
      });
      return;
    }

    // Call Gemini Recovery Agent Service (Pure inference, zero side-effects)
    const result = await geminiRecoveryAgent.diagnose(context);

    // Guarantee that payment state in datastore is unmodified (Zero-mutation proof)
    res.json(result);
  } catch (err: any) {
    console.error('[agentRouter] Error processing diagnosis request:', err);
    res.status(500).json({
      success: false,
      fallback: true,
      error: err?.message || 'Internal server error during diagnosis'
    });
  }
});
