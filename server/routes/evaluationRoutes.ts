/**
 * RecoverPay Evaluation Routes
 * Endpoint: GET /api/evaluation/compare
 * Computes deterministic multi-strategy benchmark over the 600 synthetic payment records.
 * Returns true calculated numbers (TP, FP, FN, TN, precision, recall, F1, revenue, safety violations).
 */

import { Router, Request, Response } from 'express';
import { runComparativeEvaluation } from '../evaluation/evaluator.ts';

export const evaluationRouter = Router();

/**
 * GET /api/evaluation/compare
 * Returns comparative metrics across NAIVE_RETRY_ALL, DETERMINISTIC_RULES, and RECOVERPAY_AI_POLICY.
 */
evaluationRouter.get('/compare', (req: Request, res: Response) => {
  try {
    const result = runComparativeEvaluation();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to run comparative evaluation'
    });
  }
});
