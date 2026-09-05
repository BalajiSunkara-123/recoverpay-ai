/**
 * RecoverPay Server Entry Point
 * Express 4 + Vite Middleware running on port 3000
 */

import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { dataStore } from './server/db/store.ts';
import { toAgentInputContext } from './server/data/generator.ts';
import { policyEngine } from './server/policies/policyEngine.ts';
import { agentRouter } from './server/routes/agentRoutes.ts';
import { recoveryRouter } from './server/routes/recoveryRoutes.ts';
import { dashboardRouter } from './server/routes/dashboardRoutes.ts';
import { paymentRouter } from './server/routes/paymentRoutes.ts';
import { demoRouter } from './server/routes/demoRoutes.ts';
import { evaluationRouter } from './server/routes/evaluationRoutes.ts';
import { auditRouter } from './server/routes/auditRoutes.ts';
import { razorpayRouter } from './server/routes/razorpayRoutes.ts';
import { AIAgentDecision } from './src/types/index.ts';

// Ensure supported gemini-3.8-flash model is active across server environment
if (
  !process.env.GEMINI_MODEL ||
  process.env.GEMINI_MODEL !== 'gemini-3.8-flash'
) {
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
}
console.log(`[Startup] RecoverPay Gemini Model configured: "${process.env.GEMINI_MODEL}"`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API ROUTES FIRST ---

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'RecoverPay AI Revenue Recovery Agent',
      timestamp: new Date().toISOString()
    });
  });

  // Dataset statistics endpoint
  app.get('/api/dataset/stats', (_req, res) => {
    const stats = dataStore.getStats();
    res.json({
      success: true,
      stats
    });
  });

  // Sample records endpoint (safe for inspection)
  app.get('/api/dataset/sample', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 5, 50);
    const payments = dataStore.getAllPayments().slice(0, limit);
    const customers = dataStore.getAllCustomers();
    const customerMap = new Map(customers.map(c => [c.id, c]));

    const sampled = payments.map(p => {
      const customer = customerMap.get(p.customer_id);
      return {
        payment: p,
        customer
      };
    });

    res.json({
      success: true,
      count: sampled.length,
      sample: sampled
    });
  });

  // Agent context sample (verifies zero leakage of ground truth)
  app.get('/api/dataset/agent-context-sample', (_req, res) => {
    const payment = dataStore.getAllPayments()[0];
    const customer = dataStore.getCustomerById(payment.customer_id);
    const policy = dataStore.getPolicy();

    if (!payment || !customer) {
      return res.status(404).json({ error: 'Sample record not found' });
    }

    const agentContext = toAgentInputContext(payment, customer, policy);

    res.json({
      success: true,
      message: 'Verified ground-truth fields stripped from AgentInputContext',
      agentContext
    });
  });

  // Dataset reset endpoint
  app.post('/api/dataset/reset', (_req, res) => {
    const state = dataStore.reset(1337);
    res.json({
      success: true,
      message: 'Dataset reset to default deterministic state (600 records).',
      stats: state.stats
    });
  });

  // Policy configuration endpoint
  app.get('/api/policy', (_req, res) => {
    res.json({
      success: true,
      policy: dataStore.getPolicy()
    });
  });

  // Policy evaluation test endpoint
  app.post('/api/policy/evaluate', (req, res) => {
    const { paymentId, decision } = req.body as { paymentId: string; decision: AIAgentDecision };
    if (!paymentId || !decision) {
      return res.status(400).json({ error: 'paymentId and decision payload are required' });
    }

    const payment = dataStore.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: `Payment not found: ${paymentId}` });
    }

    const customer = dataStore.getCustomerById(payment.customer_id);
    if (!customer) {
      return res.status(404).json({ error: `Customer not found for payment: ${paymentId}` });
    }

    const policy = dataStore.getPolicy();
    const result = policyEngine.evaluate(payment, customer, decision, policy);
    const enrichedResult = {
      ...result,
      status: result.allowed ? 'ALLOWED' : (result.finalAction === 'ESCALATE' ? 'ESCALATED' : 'BLOCKED')
    };

    res.json({
      success: true,
      paymentId,
      policyResult: enrichedResult
    });
  });

  // Recovery Agent API (Pure diagnostic reasoning, zero tool execution)
  app.use('/api/agent', agentRouter);

  // Recovery Execution API (Bounded Tool Router, policy enforced, idempotent)
  app.use('/api/recovery', recoveryRouter);

  // Dashboard & Real-Time Metrics API
  app.use('/api/dashboard', dashboardRouter);

  // Payment Operations & Query API
  app.use('/api/payments', paymentRouter);

  // Demo Scenarios Interactive Pipeline API
  app.use('/api/demo', demoRouter);

  // Multi-Strategy Comparative Evaluation API (Phase 6)
  app.use('/api/evaluation', evaluationRouter);

  // Cryptographic Audit Ledger API (Phase 7)
  app.use('/api/audit', auditRouter);

  // Razorpay Test Mode API (Dual-Mode Interactive Sandbox)
  app.use('/api/razorpay', razorpayRouter);

  // --- VITE MIDDLEWARE SETUP ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[RecoverPay] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[RecoverPay] Startup error:', err);
  process.exit(1);
});
