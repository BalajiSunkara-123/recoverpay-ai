/**
 * Razorpay TEST Mode Integration Tools
 * Safe test-mode operations: Payment Link generation, Order creation, and Payment verification.
 * 
 * INVARIANTS:
 * - TEST CREDENTIALS ONLY. Never used with live secrets.
 * - NEVER implements silent card charging.
 * - Missing credentials gracefully fail closed with diagnostic report (zero crashes).
 * - "TEST API SUCCESS != PAYMENT RECOVERY" (payment link created != payment captured).
 */

import { Payment, Customer, ToolResult, PaymentStatus } from '../../src/types/index.ts';

export interface RazorpayConfig {
  keyId?: string;
  keySecret?: string;
  isConfigured: boolean;
}

export function getRazorpayConfig(): RazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const isConfigured = Boolean(keyId && keySecret && keyId.startsWith('rzp_test_'));

  return {
    keyId,
    keySecret,
    isConfigured
  };
}

/**
 * Creates a genuine Razorpay TEST Mode Payment Link for customer recovery.
 */
export async function createRazorpayTestPaymentLink(
  payment: Payment,
  customer: Customer,
  idempotencyKey: string,
  customMessage?: string
): Promise<ToolResult> {
  const timestamp = new Date().toISOString();
  const config = getRazorpayConfig();

  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return {
      tool_called: 'send_payment_reminder',
      action: 'SEND_PAYMENT_REMINDER',
      execution_mode: 'RAZORPAY_TEST_API',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: 'ALLOWED',
      policy_violations: [],
      final_payment_status: payment.status,
      message: 'RAZORPAY_CREDENTIALS_MISSING: Razorpay TEST keys (RAZORPAY_KEY_ID=rzp_test_*) not configured. Test API skipped safely.',
      error_message: 'Razorpay TEST credentials absent or invalid',
      timestamp
    };
  }

  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

  try {
    const payload = {
      amount: payment.amount,
      currency: payment.currency || 'INR',
      accept_partial: false,
      description: customMessage || `RecoverPay reminder: Retry payment for ${payment.id}`,
      customer: {
        name: customer.name,
        email: customer.email,
        contact: customer.contact
      },
      notify: {
        sms: false,
        email: false
      },
      reminder_enable: false,
      reference_id: `rec_${payment.id}_${Date.now()}`
    };

    const response = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        tool_called: 'send_payment_reminder',
        action: 'SEND_PAYMENT_REMINDER',
        execution_mode: 'RAZORPAY_TEST_API',
        success: false,
        recovered: false,
        amount_recovered: 0,
        payment_id: payment.id,
        idempotency_key: idempotencyKey,
        policy_decision: 'ALLOWED',
        policy_violations: [],
        final_payment_status: payment.status,
        message: `Razorpay TEST API returned HTTP ${response.status}`,
        error_message: errorBody,
        timestamp
      };
    }

    const data = await response.json();

    // CRITICAL: Payment link created != Payment captured.
    // recovered is explicitly FALSE until customer completes payment.
    return {
      tool_called: 'send_payment_reminder',
      action: 'SEND_PAYMENT_REMINDER',
      execution_mode: 'RAZORPAY_TEST_API',
      success: true,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: 'ALLOWED',
      policy_violations: [],
      external_reference_id: data.id, // e.g. plink_xxxx
      payment_link_url: data.short_url,
      final_payment_status: payment.status,
      message: `Razorpay TEST Payment Link generated successfully (${data.id}). Awaiting customer payment.`,
      timestamp
    };
  } catch (err: any) {
    return {
      tool_called: 'send_payment_reminder',
      action: 'SEND_PAYMENT_REMINDER',
      execution_mode: 'RAZORPAY_TEST_API',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: 'ALLOWED',
      policy_violations: [],
      final_payment_status: payment.status,
      message: `Razorpay TEST API network exception: ${err.message}`,
      error_message: err.message,
      timestamp
    };
  }
}

/**
 * Creates a Razorpay TEST Order
 */
export async function createRazorpayTestOrder(
  payment: Payment,
  idempotencyKey: string
): Promise<ToolResult> {
  const timestamp = new Date().toISOString();
  const config = getRazorpayConfig();

  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return {
      tool_called: 'retry_payment',
      action: 'RETRY_PAYMENT',
      execution_mode: 'RAZORPAY_TEST_API',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: 'ALLOWED',
      policy_violations: [],
      final_payment_status: payment.status,
      message: 'RAZORPAY_CREDENTIALS_MISSING: Razorpay TEST keys not configured.',
      error_message: 'Razorpay TEST credentials absent or invalid',
      timestamp
    };
  }

  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

  try {
    const payload = {
      amount: payment.amount,
      currency: payment.currency || 'INR',
      receipt: `rec_${payment.id}`,
      notes: {
        payment_id: payment.id,
        recovery_type: 'automated_order'
      }
    };

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return {
        tool_called: 'retry_payment',
        action: 'RETRY_PAYMENT',
        execution_mode: 'RAZORPAY_TEST_API',
        success: false,
        recovered: false,
        amount_recovered: 0,
        payment_id: payment.id,
        idempotency_key: idempotencyKey,
        policy_decision: 'ALLOWED',
        policy_violations: [],
        final_payment_status: payment.status,
        message: `Razorpay TEST API returned HTTP ${response.status}`,
        error_message: errorBody,
        timestamp
      };
    }

    const data = await response.json();

    // Order created != Payment captured
    return {
      tool_called: 'retry_payment',
      action: 'RETRY_PAYMENT',
      execution_mode: 'RAZORPAY_TEST_API',
      success: true,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: 'ALLOWED',
      policy_violations: [],
      external_reference_id: data.id, // e.g. order_xxxx
      final_payment_status: payment.status,
      message: `Razorpay TEST Order created (${data.id}). Awaiting payment fulfillment.`,
      timestamp
    };
  } catch (err: any) {
    return {
      tool_called: 'retry_payment',
      action: 'RETRY_PAYMENT',
      execution_mode: 'RAZORPAY_TEST_API',
      success: false,
      recovered: false,
      amount_recovered: 0,
      payment_id: payment.id,
      idempotency_key: idempotencyKey,
      policy_decision: 'ALLOWED',
      policy_violations: [],
      final_payment_status: payment.status,
      message: `Razorpay TEST API network exception: ${err.message}`,
      error_message: err.message,
      timestamp
    };
  }
}

/**
 * Fetches and verifies test payment state from Razorpay TEST API
 */
export async function verifyRazorpayTestPayment(
  razorpayPaymentId: string
): Promise<{ success: boolean; status?: PaymentStatus; raw?: any; error?: string }> {
  const config = getRazorpayConfig();
  if (!config.isConfigured || !config.keyId || !config.keySecret) {
    return { success: false, error: 'Razorpay TEST credentials not configured' };
  }

  const authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;

  try {
    const response = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader
      }
    });

    if (!response.ok) {
      return { success: false, error: `Razorpay returned HTTP ${response.status}` };
    }

    const data = await response.json();
    let status: PaymentStatus = 'failed';
    if (data.status === 'captured') status = 'captured';
    else if (data.status === 'created' || data.status === 'authorized') status = 'created';
    else status = 'failed';

    return { success: true, status, raw: data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
