/**
 * RecoverPay Express Application Factory & Router Registry
 * Supports both persistent container execution (server.ts) and Vercel Serverless (api/index.ts).
 */

import express from 'express';
import { dataStore } from './db/store.ts';
import { toAgentInputContext } from './data/generator.ts';
import { policyEngine } from './policies/policyEngine.ts';
import { agentRouter } from './routes/agentRoutes.ts';
import { recoveryRouter } from './routes/recoveryRoutes.ts';
import { dashboardRouter } from './routes/dashboardRoutes.ts';
import { paymentRouter } from './routes/paymentRoutes.ts';
import { demoRouter } from './routes/demoRoutes.ts';
import { evaluationRouter } from './routes/evaluationRoutes.ts';
import { auditRouter } from './routes/auditRoutes.ts';
import { razorpayRouter } from './routes/razorpayRoutes.ts';
import { AIAgentDecision } from '../src/types/index.ts';

// Ensure supported gemini-3.8-flash model is active across environment
if (
  !process.env.GEMINI_MODEL ||
  process.env.GEMINI_MODEL !== 'gemini-3.8-flash'
) {
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
}

export const app = express();

app.use(express.json());

// --- CORS & VERCEL SERVERLESS ROUTING NORMALIZER ---
app.use((req, res, next) => {
  // Broad CORS for preview/production Vercel domains
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Handle Vercel edge rewrite url mapping
  const forwardedUri = req.headers['x-forwarded-uri'] as string | undefined;
  const matchedPath = (req.headers['x-matched-path'] || req.headers['x-invoke-path']) as string | undefined;
  const rawUrl = forwardedUri || req.originalUrl || req.url;

  if (rawUrl && rawUrl.includes('/api/')) {
    const idx = rawUrl.indexOf('/api/');
    req.url = rawUrl.substring(idx);
  } else if (matchedPath && matchedPath.startsWith('/api')) {
    const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    req.url = matchedPath + queryString;
  } else if (rawUrl && !rawUrl.startsWith('/api')) {
    req.url = '/api' + (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);
  }

  next();
});

// --- API ENDPOINTS (Dual-mounted with and without /api prefix for zero routing failures) ---

// 1. Health check
const handleHealth = (_req: express.Request, res: express.Response) => {
  res.json({
    status: 'ok',
    service: 'RecoverPay AI Revenue Recovery Agent',
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'node-express',
    timestamp: new Date().toISOString()
  });
};
app.get(['/api/health', '/health', '/api'], handleHealth);

// 2. Dataset statistics endpoint
const handleDatasetStats = (_req: express.Request, res: express.Response) => {
  const stats = dataStore.getStats();
  res.json({
    success: true,
    stats
  });
};
app.get(['/api/dataset/stats', '/dataset/stats'], handleDatasetStats);

// 3. Sample records endpoint (safe for inspection)
const handleDatasetSample = (req: express.Request, res: express.Response) => {
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
};
app.get(['/api/dataset/sample', '/dataset/sample'], handleDatasetSample);

// 4. Agent context sample (verifies zero leakage of ground truth)
const handleAgentContextSample = (_req: express.Request, res: express.Response) => {
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
};
app.get(['/api/dataset/agent-context-sample', '/dataset/agent-context-sample'], handleAgentContextSample);

// 5. Dataset reset endpoint
const handleDatasetReset = (_req: express.Request, res: express.Response) => {
  const state = dataStore.reset(1337);
  res.json({
    success: true,
    message: 'Dataset reset to default deterministic state (600 records).',
    stats: state.stats
  });
};
app.post(['/api/dataset/reset', '/dataset/reset'], handleDatasetReset);

// 6. Policy configuration endpoint
const handlePolicyGet = (_req: express.Request, res: express.Response) => {
  res.json({
    success: true,
    policy: dataStore.getPolicy()
  });
};
app.get(['/api/policy', '/policy'], handlePolicyGet);

// 7. Policy evaluation test endpoint
const handlePolicyEvaluate = (req: express.Request, res: express.Response) => {
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
};
app.post(['/api/policy/evaluate', '/policy/evaluate'], handlePolicyEvaluate);

// --- MODULAR ROUTERS (Dual-mounted with and without /api prefix) ---

// Recovery Agent API (Pure diagnostic reasoning, zero tool execution)
app.use(['/api/agent', '/agent'], agentRouter);

// Recovery Execution API (Bounded Tool Router, policy enforced, idempotent)
app.use(['/api/recovery', '/recovery'], recoveryRouter);

// Dashboard & Real-Time Metrics API
app.use(['/api/dashboard', '/dashboard'], dashboardRouter);

// Payment Operations & Query API
app.use(['/api/payments', '/payments'], paymentRouter);

// Demo Scenarios Interactive Pipeline API
app.use(['/api/demo', '/demo'], demoRouter);

// Multi-Strategy Comparative Evaluation API (Phase 6)
app.use(['/api/evaluation', '/evaluation'], evaluationRouter);

// Cryptographic Audit Ledger API (Phase 7)
app.use(['/api/audit', '/audit'], auditRouter);

// Razorpay Test Mode API (Dual-Mode Interactive Sandbox)
app.use(['/api/razorpay', '/razorpay'], razorpayRouter);

export default app;
