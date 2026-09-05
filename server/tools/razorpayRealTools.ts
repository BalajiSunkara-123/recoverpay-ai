/**
 * Razorpay TEST Mode Integration Tools
 * Safe test-mode operations: Payment Link generation, Order creation, and Payment verification.
 *
 * INVARIANTS:
 * - TEST CREDENTIALS ONLY. Never used with live secrets.
 * - NEVER implements silent card charging.
 * - Missing credentials gracefully fail closed with diagnostic report (zero crashes).
 * - "TEST API SUCCESS != PAYMENT RECOVERY" (payment link created != payment captured).
 * - Outcome verification is mandatory: only a verified captured status authorizes recovered = true.
 */

import {
  Payment,
  Customer,
  ToolResult,
  PaymentStatus
} from '../../src/types/index.ts';

export interface RazorpayConfig {
  keyId?: string;
  keySecret?: string;
  isConfigured: boolean;
}

export function getRazorpayConfig(): RazorpayConfig {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  const isConfigured = Boolean(
    keyId &&
    keySecret &&
    keyId.startsWith('rzp_test_')
  );

  return {
    keyId,
    keySecret,
    isConfigured
  };
}

export function getMaskedRazorpayConfig(): {
  isConfigured: boolean;
  maskedKeyId: string | null;
  mode: 'RAZORPAY_TEST' | 'DEMO';
  label: string;
} {
  const cfg = getRazorpayConfig();

  if (!cfg.isConfigured || !cfg.keyId) {
    return {
      isConfigured: false,
      maskedKeyId: null,
      mode: 'DEMO',
      label: 'SIMULATED DEMO (Razorpay Test Keys Not Configured)'
    };
  }

  const masked =
    cfg.keyId.length > 12
      ? `${cfg.keyId.slice(0, 8)}••••${cfg.keyId.slice(-4)}`
      : 'rzp_test_••••';

  return {
    isConfigured: true,
    maskedKeyId: masked,
    mode: 'RAZORPAY_TEST',
    label: 'RAZORPAY TEST MODE — NO REAL MONEY'
  };
}

export function parseRazorpayError(
  status: number,
  errorBody: string
): {
  code: string;
  message: string;
} {
  let parsedDesc = '';

  try {
    const json = JSON.parse(errorBody);

    if (json.error?.description) {
      parsedDesc = json.error.description;
    }
  } catch {
    parsedDesc = errorBody.slice(0, 150);
  }

  if (status === 401 || status === 403) {
    return {
      code: 'RAZORPAY_AUTH_FAILED',
      message:
        `Razorpay Test API authentication failed (${status}). ` +
        `Verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. ${parsedDesc}`
    };
  }

  if (status === 429) {
    return {
      code: 'RAZORPAY_RATE_LIMIT',
      message:
        'Razorpay Test API rate limit exceeded (429). Automated requests throttled safely.'
    };
  }

  if (status >= 500) {
    return {
      code: 'RAZORPAY_SERVER_ERROR',
      message:
        `Razorpay internal gateway error (${status}). ${parsedDesc}`
    };
  }

  return {
    code: 'RAZORPAY_API_ERROR',
    message:
      `Razorpay API returned HTTP ${status}: ${parsedDesc}`
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

  if (
    !config.isConfigured ||
    !config.keyId ||
    !config.keySecret
  ) {
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
      message:
        'RAZORPAY_CREDENTIALS_MISSING: Razorpay TEST keys ' +
        '(RAZORPAY_KEY_ID=rzp_test_*) not configured. Test API skipped safely.',
      error_message:
        'Razorpay TEST credentials absent or invalid',
      timestamp
    };
  }

  const authHeader =
    `Basic ${Buffer.from(
      `${config.keyId}:${config.keySecret}`
    ).toString('base64')}`;

  try {
    const payload = {
      amount: payment.amount,
      currency: payment.currency || 'INR',
      accept_partial: false,
      description:
        customMessage ||
        `RecoverPay reminder: Retry payment for ${payment.id}`,

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

      reference_id:
        `rec_${payment.id}_${Date.now()}`
    };

    /**
     * IMPORTANT:
     * This must be the actual URL.
     * Do NOT put Markdown [text](url) syntax inside the string.
     */
    const response = await fetch(
      'https://api.razorpay.com/v1/payment_links',
      {
        method: 'POST',

        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify(payload),

        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();

      const parsed = parseRazorpayError(
        response.status,
        errorBody
      );

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
        message: parsed.message,
        error_message:
          `[${parsed.code}] ${errorBody}`,
        timestamp
      };
    }

    const data = await response.json();

    /**
     * CRITICAL ZERO-TRUST INVARIANT:
     *
     * Payment Link created != Payment recovered.
     *
     * The payment remains unrecovered until Razorpay
     * confirms successful payment settlement.
     */
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

      external_reference_id: data.id,

      /**
       * This is the URL that the frontend needs
       * to render the "OPEN RAZORPAY TEST CHECKOUT" button.
       */
      payment_link_url: data.short_url,

      final_payment_status: payment.status,

      message:
        `Razorpay TEST Payment Link generated successfully ` +
        `(${data.id}). Awaiting customer authorization.`,

      timestamp
    };
  } catch (err: any) {
    const isTimeout =
      err.name === 'TimeoutError';

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

      message: isTimeout
        ? 'Razorpay TEST API network timeout (8000ms).'
        : `Razorpay TEST API network exception: ${err.message}`,

      error_message: isTimeout
        ? 'RAZORPAY_NETWORK_TIMEOUT'
        : err.message,

      timestamp
    };
  }
}

/**
 * Creates a Razorpay TEST Order.
 */
export async function createRazorpayTestOrder(
  payment: Payment,
  idempotencyKey: string
): Promise<ToolResult> {
  const timestamp = new Date().toISOString();
  const config = getRazorpayConfig();

  if (
    !config.isConfigured ||
    !config.keyId ||
    !config.keySecret
  ) {
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

      message:
        'RAZORPAY_CREDENTIALS_MISSING: Razorpay TEST keys not configured.',

      error_message:
        'Razorpay TEST credentials absent or invalid',

      timestamp
    };
  }

  const authHeader =
    `Basic ${Buffer.from(
      `${config.keyId}:${config.keySecret}`
    ).toString('base64')}`;

  try {
    const payload = {
      amount: payment.amount,
      currency: payment.currency || 'INR',

      receipt:
        `rec_${payment.id}`,

      notes: {
        payment_id: payment.id,
        recovery_type: 'automated_order'
      }
    };

    /**
     * Correct Razorpay Orders endpoint.
     */
    const response = await fetch(
      'https://api.razorpay.com/v1/orders',
      {
        method: 'POST',

        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json'
        },

        body: JSON.stringify(payload),

        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();

      const parsed = parseRazorpayError(
        response.status,
        errorBody
      );

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

        message: parsed.message,

        error_message:
          `[${parsed.code}] ${errorBody}`,

        timestamp
      };
    }

    const data = await response.json();

    /**
     * Order created != Payment captured.
     */
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

      external_reference_id: data.id,

      final_payment_status: payment.status,

      message:
        `Razorpay TEST Order created (${data.id}). ` +
        'Awaiting payment fulfillment.',

      timestamp
    };
  } catch (err: any) {
    const isTimeout =
      err.name === 'TimeoutError';

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

      message: isTimeout
        ? 'Razorpay TEST API network timeout (8000ms).'
        : `Razorpay TEST API network exception: ${err.message}`,

      error_message: isTimeout
        ? 'RAZORPAY_NETWORK_TIMEOUT'
        : err.message,

      timestamp
    };
  }
}

export interface RazorpayLinkVerification {
  success: boolean;
  paid: boolean;

  status:
    | 'created'
    | 'partially_paid'
    | 'paid'
    | 'cancelled'
    | 'expired';

  amount_paid?: number;
  payment_id?: string;
  raw?: any;

  error?: string;
  code?: string;
}

/**
 * Checks live status of a Razorpay Payment Link.
 *
 * GET /v1/payment_links/:id
 */
export async function verifyRazorpayTestPaymentLink(
  paymentLinkId: string
): Promise<RazorpayLinkVerification> {
  const config = getRazorpayConfig();

  if (
    !config.isConfigured ||
    !config.keyId ||
    !config.keySecret
  ) {
    return {
      success: false,
      paid: false,
      status: 'created',

      error:
        'Razorpay TEST credentials not configured',

      code:
        'RAZORPAY_CREDENTIALS_MISSING'
    };
  }

  const authHeader =
    `Basic ${Buffer.from(
      `${config.keyId}:${config.keySecret}`
    ).toString('base64')}`;

  try {
    /**
     * Correct Razorpay Payment Link verification endpoint.
     */
    const response = await fetch(
      `https://api.razorpay.com/v1/payment_links/${paymentLinkId}`,
      {
        method: 'GET',

        headers: {
          Authorization: authHeader
        },

        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();

      const parsed = parseRazorpayError(
        response.status,
        errorBody
      );

      return {
        success: false,
        paid: false,
        status: 'created',

        error: parsed.message,
        code: parsed.code
      };
    }

    const data = await response.json();

    const isPaid =
      data.status === 'paid';

    return {
      success: true,

      paid: isPaid,

      status: data.status,

      amount_paid:
        data.amount_paid ||
        (isPaid ? data.amount : 0),

      payment_id:
        data.payments &&
        data.payments.length > 0
          ? data.payments[0].payment_id
          : undefined,

      raw: data
    };
  } catch (err: any) {
    const isTimeout =
      err.name === 'TimeoutError';

    return {
      success: false,
      paid: false,
      status: 'created',

      error: isTimeout
        ? 'Razorpay Test API request timed out (8000ms)'
        : err.message,

      code: isTimeout
        ? 'RAZORPAY_NETWORK_TIMEOUT'
        : 'RAZORPAY_NETWORK_ERROR'
    };
  }
}

/**
 * Fetches and verifies test payment state from Razorpay TEST API.
 */
export async function verifyRazorpayTestPayment(
  razorpayPaymentId: string
): Promise<{
  success: boolean;
  status?: PaymentStatus;
  raw?: any;
  error?: string;
  code?: string;
}> {
  const config = getRazorpayConfig();

  if (
    !config.isConfigured ||
    !config.keyId ||
    !config.keySecret
  ) {
    return {
      success: false,

      error:
        'Razorpay TEST credentials not configured',

      code:
        'RAZORPAY_CREDENTIALS_MISSING'
    };
  }

  const authHeader =
    `Basic ${Buffer.from(
      `${config.keyId}:${config.keySecret}`
    ).toString('base64')}`;

  try {
    /**
     * Correct Razorpay Payment verification endpoint.
     */
    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${razorpayPaymentId}`,
      {
        method: 'GET',

        headers: {
          Authorization: authHeader
        },

        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();

      const parsed = parseRazorpayError(
        response.status,
        errorBody
      );

      return {
        success: false,
        error: parsed.message,
        code: parsed.code
      };
    }

    const data = await response.json();

    let status: PaymentStatus = 'failed';

    if (data.status === 'captured') {
      status = 'captured';
    } else if (
      data.status === 'created' ||
      data.status === 'authorized'
    ) {
      status = 'created';
    } else {
      status = 'failed';
    }

    return {
      success: true,
      status,
      raw: data
    };
  } catch (err: any) {
    const isTimeout =
      err.name === 'TimeoutError';

    return {
      success: false,

      error: isTimeout
        ? 'Razorpay Test API request timed out (8000ms)'
        : err.message,

      code: isTimeout
        ? 'RAZORPAY_NETWORK_TIMEOUT'
        : 'RAZORPAY_NETWORK_ERROR'
    };
  }
}