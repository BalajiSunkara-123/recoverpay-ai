/**
 * RecoverPay Cryptographic Audit Ledger Routes
 * Exposes inspection and mathematical verification for the append-only SHA-256 audit ledger.
 */

import { Router, Request, Response } from 'express';
import { dataStore } from '../db/store.ts';
import { verifyAuditChain } from '../db/auditLedger.ts';

export const auditRouter = Router();

/**
 * GET /api/audit/verify
 * Authoritatively verifies the entire cryptographic hash chain from genesis to head.
 */
auditRouter.get('/verify', (_req: Request, res: Response): void => {
  try {
    const events = dataStore.getAuditEvents();
    const verification = verifyAuditChain(events);

    res.json({
      success: true,
      verification,
      timestamp: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Error executing audit chain verification'
    });
  }
});

/**
 * GET /api/audit
 * Returns audit events with optional pagination and paymentId filtering.
 */
auditRouter.get('/', (req: Request, res: Response): void => {
  try {
    const paymentId = req.query.payment_id as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const allEvents = dataStore.getAuditEvents(paymentId);
    const total = allEvents.length;
    const events = allEvents.slice(offset, offset + limit);

    res.json({
      success: true,
      total,
      offset,
      limit,
      events
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve audit events'
    });
  }
});

/**
 * GET /api/audit/:paymentId
 * Returns audit trail for a specific payment.
 */
auditRouter.get('/:paymentId', (req: Request, res: Response): void => {
  try {
    const { paymentId } = req.params;
    const events = dataStore.getAuditEvents(paymentId);

    res.json({
      success: true,
      paymentId,
      total: events.length,
      events
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to retrieve audit events for payment'
    });
  }
});
