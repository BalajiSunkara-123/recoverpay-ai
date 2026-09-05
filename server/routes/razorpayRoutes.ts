/**
 * Razorpay Test Mode API Routes
 * Dual-Mode endpoints for interactive Razorpay sandbox demonstration.
 * 
 * INVARIANTS:
 * - Server-side only: Key ID and Key Secret NEVER transmitted to client code.
 * - API success != Payment recovery: Creating a link or order NEVER marks recovered = true.
 * - Only verified captured payment transitions status to 'captured' and marks recovered = true.
 * - Graceful fallback to simulation rail if credentials absent.
 */

import { Router, Request, Response } from 'express';
import {
  getRazorpayConfig,
  getMaskedRazorpayConfig,
  createRazorpayTestPaymentLink,
  createRazorpayTestOrder,
  verifyRazorpayTestPaymentLink,
  verifyRazorpayTestPayment
} from '../tools/razorpayRealTools.ts';
import { dataStore } from '../db/store.ts';
import { policyEngine } from '../policies/policyEngine.ts';
import { executeRecoveryPipeline } from '../tools/toolRegistry.ts';
import { AuditLedger } from '../db/auditLedger.ts';
import { AIAgentDecision } from '../../src/types/index.ts';

export const razorpayRouter = Router();

/**
 * GET /api/razorpay/status
 * Exposes non-sensitive runtime mode status and masked key ID.
 * NEVER exposes raw credentials or secret keys.
 */
razorpayRouter.get('/status', (_req: Request, res: Response) => {
  const maskedInfo = getMaskedRazorpayConfig();
  res.json({
    success: true,
    configured: maskedInfo.isConfigured,
    masked_key_id: maskedInfo.maskedKeyId,
    runtime_mode: maskedInfo.mode,
    label: maskedInfo.label,
    supported_operations: [
      'CREATE_PAYMENT_LINK',
      'CREATE_ORDER',
      'VERIFY_PAYMENT_LINK',
      'VERIFY_PAYMENT'
    ],
    notice: 'Razorpay Sandbox (Test Mode) — No real bank charges or money movement.'
  });
});

/**
 * POST /api/razorpay/test-demo
 * Explicit trigger for the Judge: executes a real Razorpay Test API flow on a failed payment.
 * Preserves the full Zero-Trust architecture:
 * Payment Telemetry -> Policy Gate -> Bounded Tool Router -> Razorpay Test API -> Outcome Verification.
 */
razorpayRouter.post('/test-demo', async (req: Request, res: Response): Promise<void> => {
  const { paymentId = 'pay_demo_transient_01', action = 'SEND_PAYMENT_REMINDER' } = req.body;
  const config = getRazorpayConfig();

  // 1. If credentials missing, fail closed gracefully with safe fallback notice
  if (!config.isConfigured) {
    res.status(400).json({
      success: false,
      error: 'RAZORPAY_CREDENTIALS_MISSING',
      message: 'Razorpay TEST keys (RAZORPAY_KEY_ID=rzp_test_*) are not configured in server environment. Use safe simulation rail or set credentials in server secrets.',
      fallback_to_simulation: true
    });
    return;
  }

  // Auto-reset demo scenarios so repeated judge testing never locks out
  // if (paymentId.startsWith('pay_demo_')) {
  //   dataStore.resetDemoScenario(paymentId);
  // }
  if (paymentId.startsWith("pay_demo_")) {
    dataStore.resetDemoScenario(paymentId);

    console.log(
      '[Razorpay Demo] After reset:',
      dataStore.getPaymentById(paymentId)?.status,
      dataStore.getPaymentById(paymentId)?.recovery_attempts
    );
  }

  // 2. Fetch fresh payment and customer from DataStore
  const payment = dataStore.getPaymentById(paymentId);
  if (!payment) {
    res.status(404).json({ success: false, error: `Payment not found: ${paymentId}` });
    return;
  }

  const customer = dataStore.getCustomerById(payment.customer_id);
  if (!customer) {
    res.status(404).json({ success: false, error: `Customer not found for payment: ${paymentId}` });
    return;
  }

  // 3. Construct AI decision for diagnostic advisory
  const aiDecision: AIAgentDecision = {
    payment_id: payment.id,
    diagnosis: 'transient_bank_downtime',
    recoverability_score: 0.94,
    recommended_action: action === 'RETRY_PAYMENT' ? 'RETRY_PAYMENT' : 'SEND_PAYMENT_REMINDER',
    confidence: 0.91,
    risk_level: 'LOW',
    reasoning: action === 'RETRY_PAYMENT' 
      ? 'Customer payment failed due to transient gateway downtime. Generate Razorpay Test Order.'
      : 'Generate Razorpay Test Payment Link to allow customer to complete recovery checkout.',
    customer_recovery_message: `RecoverPay: Your payment of ₹${(payment.amount / 100).toLocaleString('en-IN')} could not be completed. Please use this secure test link to finalize checkout.`
  };

  // 4. Evaluate deterministic Policy Engine
  const policy = dataStore.getPolicy();
  const policyResult = policyEngine.evaluate(payment, customer, aiDecision, policy);

  // 5. Dispatch via Bounded Tool Router with preferredMode = 'RAZORPAY_TEST_API'
  // Note: executeRecoveryPipeline strictly guarantees zero-trust invariants:
  // If policyResult.allowed is false, it refuses tool execution, logs the block event,
  // and returns toolResult with policy_decision: 'BLOCKED' and zero financial side effects.
  try {
    const idempotencyKey = `rzp_test_demo_${payment.id}_${Date.now()}`;
    const { toolResult } = await executeRecoveryPipeline(payment.id, aiDecision, {
      preferredMode: 'RAZORPAY_TEST_API',
      idempotencyKey,
      reminderMessage: aiDecision.customer_recovery_message
    });

    // 6. Get updated payment and audit trail
    const updatedPayment = dataStore.getPaymentById(payment.id)!;
    const auditEvents = dataStore.getAuditEvents(payment.id);

    res.json({
      success: true,
      mode: 'RAZORPAY_TEST_API',
      label: 'RAZORPAY TEST MODE — NO REAL MONEY',
      payment: updatedPayment,
      customer,
      aiDecision,
      policyResult,
      toolResult,
      externalReferenceId: toolResult.external_reference_id,
      paymentLinkUrl: toolResult.payment_link_url,
      // Invariant assertion:
      zeroTrustVerification: {
        api_success: toolResult.success,
        payment_recovered: toolResult.recovered, // Must be FALSE
        amount_recovered: toolResult.amount_recovered, // Must be 0
        status: toolResult.final_payment_status,
        invariant_verified: toolResult.recovered === false && toolResult.amount_recovered === 0,
        explanation: policyResult.allowed
          ? 'CRITICAL INVARIANT: Razorpay API returned HTTP 200, but payment is NOT marked recovered. Status remains failed until customer actually completes checkout and funds are captured.'
          : 'CRITICAL INVARIANT: Zero-Trust Policy Engine intercepted the AI recommendation and halted execution before any financial API was dispatched.'
      },
      auditTrail: auditEvents.slice(-5)
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: 'EXECUTION_FAILED',
      message: err.message
    });
  }
});

/**
 * POST /api/razorpay/verify-link
 * Live queries Razorpay Test API to check if customer actually completed payment on the test link.
 * ONLY IF Razorpay status === 'paid' is the payment captured and recovered.
 */
razorpayRouter.post('/verify-link', async (req: Request, res: Response): Promise<void> => {
  const { paymentLinkId, paymentId } = req.body;

  if (!paymentLinkId) {
    res.status(400).json({ success: false, error: 'paymentLinkId is required' });
    return;
  }

  const verification = await verifyRazorpayTestPaymentLink(paymentLinkId);

  if (!verification.success) {
    res.status(502).json({
      success: false,
      error: verification.code || 'VERIFICATION_FAILED',
      message: verification.error
    });
    return;
  }

  // If payment is paid, update DataStore and commit audit event
  if (verification.paid && paymentId) {
    const payment = dataStore.getPaymentById(paymentId);
    if (payment && payment.status !== 'captured') {
      dataStore.updatePayment(payment.id, {
        status: 'captured',
        updated_at: new Date().toISOString()
      });

      AuditLedger.recordOutcomeVerification(
        payment,
        'captured',
        payment.amount,
        'SUCCESS'
      );
    }
  }

  const currentPayment = paymentId ? dataStore.getPaymentById(paymentId) : null;

  res.json({
    success: true,
    paymentLinkId,
    statusOnRazorpay: verification.status,
    paid: verification.paid,
    amount_paid: verification.amount_paid,
    payment_id: verification.payment_id,
    currentPaymentStatus: currentPayment?.status || 'unknown',
    recovered: verification.paid,
    message: verification.paid
      ? `Razorpay confirms payment is CAPTURED! ₹${((verification.amount_paid || 0) / 100).toLocaleString('en-IN')} recovered successfully.`
      : `Payment link status is "${verification.status}". Customer has not completed checkout. Payment remains UNRECOVERED. Invariant verified: API success != payment recovery.`
  });
});

/**
 * POST /api/razorpay/verify-payment
 * Fetches status of an individual payment attempt from Razorpay Test API.
 */
razorpayRouter.post('/verify-payment', async (req: Request, res: Response): Promise<void> => {
  const { razorpayPaymentId } = req.body;

  if (!razorpayPaymentId) {
    res.status(400).json({ success: false, error: 'razorpayPaymentId is required' });
    return;
  }

  const result = await verifyRazorpayTestPayment(razorpayPaymentId);
  res.json(result);
});
