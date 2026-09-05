/**
 * RecoverPay Payment Operations Routes
 * Provides search, filter, pagination, and inspection for the Merchant Recovery Console.
 */

import { Router, Request, Response } from 'express';
import { dataStore } from '../db/store.ts';
import { Payment, Customer, AuditEvent } from '../../src/types/index.ts';

export const paymentRouter = Router();

export interface EnrichedPaymentListItem {
  payment: Payment;
  customer: Customer | null;
  auditCount: number;
  latestEvent: AuditEvent | null;
  id: string;
  customer_name?: string;
  customer_id: string;
  amount: number;
  failure_reason: string;
  error_code: string;
  recovery_attempts: number;
  status: Payment['status'];
  last_agent_action?: string;
  last_agent_confidence?: number;
  last_policy_status?: string;
  last_tool_name?: string;
}

/**
 * GET /api/payments
 * Query params:
 * - filter: 'all' | 'recoverable' | 'recovered' | 'blocked' | 'escalated' | 'high_value' | 'opted_out' | 'retry' | 'reminder' | 'stop'
 * - search: string (matches payment.id, customer.name, customer.id, failure_code)
 * - limit: number (default 50)
 * - offset: number (default 0)
 * - sort: 'recent' | 'amount_desc' | 'amount_asc'
 */
paymentRouter.get('/', (req: Request, res: Response): void => {
  const filter = (req.query.filter as string) || 'all';
  const search = ((req.query.search as string) || '').trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
  const sort = (req.query.sort as string) || 'recent';

  // Merge regular dataset with demo scenarios to ensure demo payments can always be found
  const allPayments = dataStore.getAllPayments();
  const allDemoScenarios = dataStore.getAllDemoScenarios();
  const combinedMap = new Map<string, Payment>();

  // Prioritize demo scenarios first so they are easily visible at the top
  for (const demoKey of Object.keys(allDemoScenarios)) {
    const demoPay = allDemoScenarios[demoKey].payment;
    combinedMap.set(demoPay.id, demoPay);
  }
  for (const p of allPayments) {
    if (!combinedMap.has(p.id)) {
      combinedMap.set(p.id, p);
    }
  }

  let payments = Array.from(combinedMap.values());
  const customers = dataStore.getAllCustomers();
  const customerMap = new Map<string, Customer>(customers.map(c => [c.id, c]));
  
  // Also index demo customers
  for (const demoKey of Object.keys(allDemoScenarios)) {
    const demoCust = allDemoScenarios[demoKey].customer;
    customerMap.set(demoCust.id, demoCust);
  }

  // 1. Search Filter
  if (search) {
    payments = payments.filter(p => {
      const cust = customerMap.get(p.customer_id);
      const matchesId = p.id.toLowerCase().includes(search);
      const matchesCustId = p.customer_id.toLowerCase().includes(search);
      const matchesCustName = cust?.name.toLowerCase().includes(search);
      const matchesFailureCode = p.failure_code.toLowerCase().includes(search);
      const matchesFailureReason = p.failure_reason.toLowerCase().includes(search);
      return matchesId || matchesCustId || matchesCustName || matchesFailureCode || matchesFailureReason;
    });
  }

  // 2. Category / Status Filter
  if (filter !== 'all') {
    payments = payments.filter(p => {
      const cust = customerMap.get(p.customer_id);
      switch (filter) {
        case 'recoverable':
          return p.ground_truth_recoverable ||
            p.failure_category === 'TRANSIENT_BANK_FAILURE' ||
            p.failure_category === 'NETWORK_ERROR';
        case 'recovered':
          return p.status === 'captured';
        case 'blocked': {
          const events = dataStore.getAuditEvents(p.id);
          const hasBlockedEvent = events.some(e => e.policy_decision === 'BLOCKED');
          return hasBlockedEvent || p.status === 'abandoned';
        }
        case 'escalated':
          return p.status === 'escalated';
        case 'high_value':
          return p.amount > 5000000; // > ₹50,000
        case 'opted_out':
          return cust?.opted_out === true;
        case 'retry':
          return p.ground_truth_best_action === 'RETRY_PAYMENT';
        case 'reminder':
          return p.ground_truth_best_action === 'SEND_PAYMENT_REMINDER';
        case 'stop':
          return p.ground_truth_best_action === 'STOP' || p.status === 'abandoned';
        default:
          return true;
      }
    });
  }

  // 3. Sorting
  if (sort === 'amount_desc') {
    payments.sort((a, b) => b.amount - a.amount);
  } else if (sort === 'amount_asc') {
    payments.sort((a, b) => a.amount - b.amount);
  } else {
    // Recent / Demo first
    payments.sort((a, b) => {
      const isDemoA = a.id.startsWith('pay_demo_');
      const isDemoB = b.id.startsWith('pay_demo_');
      if (isDemoA && !isDemoB) return -1;
      if (!isDemoA && isDemoB) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  const total = payments.length;
  const sliced = payments.slice(offset, offset + limit);

  const enriched: EnrichedPaymentListItem[] = sliced.map(p => {
    const cust = customerMap.get(p.customer_id) || null;
    const events = dataStore.getAuditEvents(p.id);
    const latestEvent = events.length > 0 ? events[events.length - 1] : null;
    return {
      payment: p,
      customer: cust,
      auditCount: events.length,
      latestEvent,
      id: p.id,
      customer_name: cust?.name,
      customer_id: p.customer_id,
      amount: p.amount,
      failure_reason: p.failure_reason,
      error_code: p.failure_code,
      recovery_attempts: p.recovery_attempts,
      status: p.status,
      last_agent_action: latestEvent?.recommended_action,
      last_agent_confidence: latestEvent?.confidence,
      last_policy_status: latestEvent?.policy_decision,
      last_tool_name: latestEvent?.tool_called
    };
  });

  res.json({
    success: true,
    total,
    count: enriched.length,
    offset,
    limit,
    payments: enriched
  });
});

/**
 * GET /api/payments/:paymentId
 * Detailed inspection endpoint for AuditDrawer.
 */
paymentRouter.get('/:paymentId', (req: Request, res: Response): void => {
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
