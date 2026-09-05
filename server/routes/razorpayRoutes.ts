/**
 * Razorpay Test Mode API Routes
 *
 * INVARIANTS:
 * - Server-side only: Key ID and Key Secret NEVER transmitted to client code.
 * - Every /test-demo request creates a fresh local failed transaction.
 * - Creating a Razorpay link/order NEVER marks the local payment as recovered.
 * - Only verified captured payment transitions the local payment to 'captured'.
 * - Deterministic policy engine remains the final authority before execution.
 */

import { Router, Request, Response } from 'express';

import {
  getRazorpayConfig,
  getMaskedRazorpayConfig,
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
 *
 * Exposes only non-sensitive Razorpay runtime information.
 * NEVER exposes the Razorpay secret.
 */
razorpayRouter.get(
  '/status',
  (_req: Request, res: Response) => {
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

      notice:
        'Razorpay Sandbox (Test Mode) — No real bank charges or money movement.'
    });
  }
);

/**
 * POST /api/razorpay/test-demo
 *
 * Creates a COMPLETELY NEW local failed transaction for every request.
 *
 * Flow:
 *
 * New Transaction
 *       ↓
 * Payment Telemetry
 *       ↓
 * AI Decision
 *       ↓
 * Deterministic Policy Engine
 *       ↓
 * Bounded Tool Router
 *       ↓
 * Razorpay TEST API
 *       ↓
 * Payment Link / Order
 *
 * IMPORTANT:
 * Creating the Razorpay resource does NOT mean the payment
 * has been recovered.
 */
razorpayRouter.post(
  '/test-demo',
  async (req: Request, res: Response): Promise<void> => {

    const {
      action = 'SEND_PAYMENT_REMINDER'
    } = req.body || {};

    // ------------------------------------------------------------
    // 1. Check Razorpay configuration
    // ------------------------------------------------------------

    const config = getRazorpayConfig();

    if (!config.isConfigured) {
      res.status(400).json({
        success: false,
        error: 'RAZORPAY_CREDENTIALS_MISSING',
        message:
          'Razorpay TEST keys are not configured in the server environment.',
        fallback_to_simulation: true
      });

      return;
    }

    // ------------------------------------------------------------
    // 2. CREATE A COMPLETELY NEW TRANSACTION
    // ------------------------------------------------------------
    //
    // This is the important change.
    //
    // We no longer use:
    // pay_demo_transient_01
    //
    // We no longer call:
    // resetDemoScenario()
    //
    // Every request receives a fresh failed payment.
    //

    const freshPayment = dataStore.createTestTransaction();

    const paymentId = freshPayment.id;

    console.log(
      `[Razorpay Demo] Created fresh transaction: ${paymentId}`
    );

    // ------------------------------------------------------------
    // 3. Fetch the newly-created payment
    // ------------------------------------------------------------

    const payment = dataStore.getPaymentById(paymentId);

    if (!payment) {
      res.status(404).json({
        success: false,
        error: `Payment not found: ${paymentId}`
      });

      return;
    }

    // ------------------------------------------------------------
    // 4. Fetch customer
    // ------------------------------------------------------------

    const customer = dataStore.getCustomerById(
      payment.customer_id
    );

    if (!customer) {
      res.status(404).json({
        success: false,
        error:
          `Customer not found for payment: ${paymentId}`
      });

      return;
    }

    // ------------------------------------------------------------
    // 5. Construct AI decision
    // ------------------------------------------------------------

    const aiDecision: AIAgentDecision = {
      payment_id: payment.id,

      diagnosis: 'transient_bank_downtime',

      recoverability_score: 0.94,

      recommended_action:
        action === 'RETRY_PAYMENT'
          ? 'RETRY_PAYMENT'
          : 'SEND_PAYMENT_REMINDER',

      confidence: 0.91,

      risk_level: 'LOW',

      reasoning:
        action === 'RETRY_PAYMENT'
          ? 'Customer payment failed due to transient gateway downtime. Generate Razorpay Test Order.'
          : 'Generate Razorpay Test Payment Link to allow customer to complete recovery checkout.',

      customer_recovery_message:
        `RecoverPay: Your payment of ₹${(
          payment.amount / 100
        ).toLocaleString('en-IN')} could not be completed. ` +
        `Please use this secure test link to finalize checkout.`
    };

    // ------------------------------------------------------------
    // 6. Deterministic policy evaluation
    // ------------------------------------------------------------

    const policy = dataStore.getPolicy();

    const policyResult =
      policyEngine.evaluate(
        payment,
        customer,
        aiDecision,
        policy
      );

    // ------------------------------------------------------------
    // 7. STOP immediately if policy blocks the action
    // ------------------------------------------------------------

    if (!policyResult.allowed) {

      res.status(403).json({
        success: false,

        error: 'POLICY_BLOCKED',

        paymentId,

        policyResult,

        message:
          'Razorpay Test execution was blocked by the deterministic policy engine.'
      });

      return;
    }

    // ------------------------------------------------------------
    // 8. Execute bounded Razorpay Test Mode operation
    // ------------------------------------------------------------

    try {

      const idempotencyKey =
        `rzp_test_demo_${payment.id}_${Date.now()}`;

      const {
        toolResult
      } = await executeRecoveryPipeline(
        payment.id,
        aiDecision,
        {
          preferredMode: 'RAZORPAY_TEST_API',

          idempotencyKey,

          reminderMessage:
            aiDecision.customer_recovery_message
        }
      );

      // ----------------------------------------------------------
      // 9. Read updated local transaction
      // ----------------------------------------------------------

      const updatedPayment =
        dataStore.getPaymentById(payment.id);

      const auditEvents =
        dataStore.getAuditEvents(payment.id);

      // ----------------------------------------------------------
      // 10. Return complete demonstration result
      // ----------------------------------------------------------

      res.json({

        success: true,

        mode: 'RAZORPAY_TEST_API',

        label:
          'RAZORPAY TEST MODE — NO REAL MONEY',

        payment: updatedPayment,

        customer,

        aiDecision,

        policyResult,

        toolResult,

        externalReferenceId:
          toolResult.external_reference_id,

        paymentLinkUrl:
          toolResult.payment_link_url,

        // --------------------------------------------------------
        // ZERO-TRUST INVARIANT
        // --------------------------------------------------------

        zeroTrustVerification: {

          api_success:
            toolResult.success,

          payment_recovered:
            toolResult.recovered,

          amount_recovered:
            toolResult.amount_recovered,

          status:
            toolResult.final_payment_status,

          invariant_verified:
            toolResult.recovered === false &&
            toolResult.amount_recovered === 0,

          explanation:
            'Creating a Razorpay Test payment link or order does NOT recover the payment. The local transaction remains failed until Razorpay verification confirms that the customer actually completed payment.'
        },

        auditTrail:
          auditEvents.slice(-5)
      });

    } catch (err: any) {

      console.error(
        '[Razorpay Demo] Execution failed:',
        err
      );

      res.status(500).json({
        success: false,

        error: 'EXECUTION_FAILED',

        paymentId,

        message:
          err?.message ||
          'Unknown Razorpay execution error'
      });
    }
  }
);

/**
 * POST /api/razorpay/verify-link
 *
 * Checks Razorpay Test Mode payment-link status.
 *
 * ONLY when Razorpay reports the link as paid do we
 * mark the corresponding local transaction as captured.
 */
razorpayRouter.post(
  '/verify-link',
  async (
    req: Request,
    res: Response
  ): Promise<void> => {

    const {
      paymentLinkId,
      paymentId
    } = req.body || {};

    if (!paymentLinkId) {
      res.status(400).json({
        success: false,
        error: 'paymentLinkId is required'
      });

      return;
    }

    try {

      const verification =
        await verifyRazorpayTestPaymentLink(
          paymentLinkId
        );

      if (!verification.success) {

        res.status(502).json({
          success: false,
          error:
            verification.code ||
            'VERIFICATION_FAILED',
          message:
            verification.error
        });

        return;
      }

      // ----------------------------------------------------------
      // Only a PAID Razorpay payment can recover the transaction
      // ----------------------------------------------------------

      if (
        verification.paid &&
        paymentId
      ) {

        const payment =
          dataStore.getPaymentById(paymentId);

        if (
          payment &&
          payment.status !== 'captured'
        ) {

          dataStore.updatePayment(
            payment.id,
            {
              status: 'captured',
              updated_at:
                new Date().toISOString()
            }
          );

          AuditLedger.recordOutcomeVerification(
            payment,
            'captured',
            payment.amount,
            'SUCCESS'
          );
        }
      }

      const currentPayment =
        paymentId
          ? dataStore.getPaymentById(paymentId)
          : null;

      res.json({

        success: true,

        paymentLinkId,

        statusOnRazorpay:
          verification.status,

        paid:
          verification.paid,

        amount_paid:
          verification.amount_paid,

        payment_id:
          verification.payment_id,

        currentPaymentStatus:
          currentPayment?.status ||
          'unknown',

        recovered:
          verification.paid,

        message:
          verification.paid

            ? `Razorpay confirms payment is CAPTURED! ₹${(
                (verification.amount_paid || 0) / 100
              ).toLocaleString('en-IN')} recovered successfully.`

            : `Payment link status is "${verification.status}". Customer has not completed checkout. Payment remains UNRECOVERED.`
      });

    } catch (err: any) {

      console.error(
        '[Razorpay Verify Link] Error:',
        err
      );

      res.status(500).json({
        success: false,
        error: 'VERIFICATION_EXECUTION_FAILED',
        message:
          err?.message ||
          'Unable to verify Razorpay payment link'
      });
    }
  }
);

/**
 * POST /api/razorpay/verify-payment
 *
 * Fetches the status of an individual Razorpay Test Mode payment.
 */
razorpayRouter.post(
  '/verify-payment',
  async (
    req: Request,
    res: Response
  ): Promise<void> => {

    const {
      razorpayPaymentId
    } = req.body || {};

    if (!razorpayPaymentId) {
      res.status(400).json({
        success: false,
        error:
          'razorpayPaymentId is required'
      });

      return;
    }

    try {

      const result =
        await verifyRazorpayTestPayment(
          razorpayPaymentId
        );

      res.json(result);

    } catch (err: any) {

      console.error(
        '[Razorpay Verify Payment] Error:',
        err
      );

      res.status(500).json({
        success: false,
        error: 'PAYMENT_VERIFICATION_FAILED',
        message:
          err?.message ||
          'Unable to verify Razorpay payment'
      });
    }
  }
);

export default razorpayRouter;