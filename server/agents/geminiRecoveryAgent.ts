/**
 * RecoverPay Gemini Probabilistic Recovery Agent
 * Diagnostic AI agent that analyzes failed payment telemetry and outputs structured recovery recommendations.
 * 
 * ARCHITECTURAL SAFETY GUARANTEES:
 * 1. Zero-Execution: This agent CANNOT execute payment actions or call Razorpay APIs.
 * 2. Zero-State-Mutation: This agent CANNOT mutate payment status or customer records.
 * 3. Ground-Truth Isolated: Input context is strictly sanitized; hidden evaluation labels are impossible to access.
 * 4. Fails Closed: Missing API keys, timeouts, malformed JSON, and validation failures all fallback to ESCALATE.
 * 5. Pre-Policy Engine: Recommendations are strictly advisory and must pass the deterministic policy engine.
 */

import { GoogleGenAI, Type } from '@google/genai';
import {
  AgentInputContext,
  AgentResult,
  AIAgentDecision
} from '../../src/types/index.ts';
import {
  RECOVERY_AGENT_SYSTEM_INSTRUCTION,
  buildAgentUserPrompt
} from './promptTemplates.ts';
import {
  validateAgentDecision,
  createFallbackDecision
} from './validation.ts';

export interface RecoveryAgentService {
  diagnose(context: AgentInputContext): Promise<AgentResult>;
}

const DECISION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    payment_id: {
      type: Type.STRING,
      description: 'The exact payment ID matching the input telemetry context'
    },
    diagnosis: {
      type: Type.STRING,
      enum: [
        'transient_bank_downtime',
        'network_timeout',
        'insufficient_funds',
        'authentication_failure',
        'expired_card',
        'fatal_declined_card'
      ],
      description: 'Probabilistic classification of the failure root cause'
    },
    recoverability_score: {
      type: Type.NUMBER,
      description: 'Estimated probability of recovery between 0.00 and 1.00'
    },
    recommended_action: {
      type: Type.STRING,
      enum: [
        'RETRY_PAYMENT',
        'SEND_PAYMENT_REMINDER',
        'ESCALATE',
        'STOP'
      ],
      description: 'Recommended bounded recovery action'
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Model confidence in recommendation between 0.00 and 1.00'
    },
    risk_level: {
      type: Type.STRING,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      description: 'Risk assessment category'
    },
    reasoning: {
      type: Type.STRING,
      description: 'Technical explanation of diagnostic rationale and evidence'
    },
    customer_recovery_message: {
      type: Type.STRING,
      description: 'Polite customer payment link message ONLY when recommended_action is SEND_PAYMENT_REMINDER'
    }
  },
  required: [
    'payment_id',
    'diagnosis',
    'recoverability_score',
    'recommended_action',
    'confidence',
    'risk_level',
    'reasoning'
  ]
};

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const SUPPORTED_GEMINI_MODEL = DEFAULT_GEMINI_MODEL;

export function resolveGeminiModel(): string {
  const envModel = (process.env.GEMINI_MODEL || '').trim();
  if (envModel) {
    return envModel;
  }
  return DEFAULT_GEMINI_MODEL;
}

export class GeminiRecoveryAgent implements RecoveryAgentService {
  private defaultTimeoutMs: number;

  constructor() {
    this.defaultTimeoutMs = parseInt(process.env.GEMINI_TIMEOUT_MS || '8000', 10);
  }

  public getModel(): string {
    return resolveGeminiModel();
  }

  /**
   * Diagnostic entry point.
   * Receives sanitized AgentInputContext (never ground truth).
   * Returns bounded AgentResult.
   */
  async diagnose(context: AgentInputContext): Promise<AgentResult> {
    const paymentId = context?.payment?.id || 'unknown_payment';
    const timestamp = new Date().toISOString();
    const activeModel = resolveGeminiModel();

    // 1. API Key Availability Check
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '' || apiKey === 'MY_GEMINI_API_KEY') {
      const fallbackDecision = createFallbackDecision(
        paymentId,
        'GEMINI_API_KEY is not configured in server environment. Automated recovery halted.'
      );

      this.logOperation({
        paymentId,
        status: 'FALLBACK',
        action: fallbackDecision.recommended_action,
        confidence: fallbackDecision.confidence,
        reason: 'GEMINI_API_KEY_MISSING',
        timestamp
      });

      return {
        success: false,
        fallback: true,
        decision: fallbackDecision,
        error: 'GEMINI_API_KEY_MISSING: API key is not configured'
      };
    }

    // 2. Build User Prompt from sanitized context
    const userPrompt = buildAgentUserPrompt(context);

    try {
      // Initialize modern @google/genai SDK client with telemetry User-Agent header
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build'
          }
        }
      });
      const timeoutMs = this.defaultTimeoutMs;

      // 3. Outbound Request with Bounded Retry (Max 2 retries, exponential backoff)
      const maxRetries = 2;
      let lastError: any = null;
      let responseText: string | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Diagnostic log reporting MODEL ID without exposing API key
          console.log(
            `[GeminiRecoveryAgent] Outbound Gemini API request | model="${activeModel}" | payment="${paymentId}" | attempt=${attempt + 1}/${maxRetries + 1}`
          );

          const generatePromise = ai.models.generateContent({
            model: activeModel,
            contents: userPrompt,
            config: {
              systemInstruction: RECOVERY_AGENT_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: DECISION_SCHEMA,
              temperature: 0.1
            }
          });

          let timerId: any = null;
          const timeoutPromise = new Promise<never>((_, reject) => {
            timerId = setTimeout(() => {
              reject(new Error(`Gemini inference timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          });

          const response = await Promise.race([generatePromise, timeoutPromise]);
          if (timerId) clearTimeout(timerId);

          if (!response || !response.text) {
            throw new Error('Empty response received from Gemini API');
          }

          responseText = response.text;
          break; // Successful call, exit retry loop
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isRetryable =
            errMsg.includes('503') ||
            errMsg.includes('UNAVAILABLE') ||
            errMsg.includes('high demand') ||
            errMsg.includes('429') ||
            errMsg.includes('ResourceExhausted') ||
            err?.status === 503 ||
            err?.status === 429;

          if (attempt < maxRetries && isRetryable) {
            const backoffMs = 1000 * Math.pow(2, attempt); // 1000ms, then 2000ms
            console.warn(
              `[GeminiRecoveryAgent] Temporary API error (${err?.status || '503'}): ${errMsg.slice(0, 120)} | model="${activeModel}" | scheduling retry ${attempt + 2}/${maxRetries + 1} in ${backoffMs}ms`
            );
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          } else {
            // Non-retryable error or retries exhausted: break out and trigger fail-closed fallback
            break;
          }
        }
      }

      if (!responseText) {
        throw lastError || new Error('All Gemini recovery diagnosis attempts failed');
      }

      // 4. Parse JSON Response
      let rawDecision: any;
      try {
        rawDecision = JSON.parse(responseText);
      } catch (parseError: any) {
        throw new Error(`Failed to parse Gemini response as JSON: ${parseError.message}`);
      }

      // 5. Strict Runtime Validation
      const validation = validateAgentDecision(rawDecision, paymentId);
      if (!validation.valid || !validation.decision) {
        throw new Error(`Agent decision schema validation failed: ${validation.error}`);
      }

      // 6. Return Successful Validated Decision
      const decision = validation.decision;

      this.logOperation({
        paymentId,
        status: 'SUCCESS',
        action: decision.recommended_action,
        confidence: decision.confidence,
        reason: decision.reasoning,
        timestamp
      });

      return {
        success: true,
        fallback: false,
        decision
      };
    } catch (err: any) {
      // 7. Resilient Fallback Handling for Timeouts, API Errors, or Schema Violations
      const errorMessage = err?.message || 'Unknown Gemini error';
      const fallbackDecision = createFallbackDecision(
        paymentId,
        `Gemini diagnosis failed (${errorMessage}). Bounded safety default applied.`
      );

      this.logOperation({
        paymentId,
        status: 'FALLBACK',
        action: fallbackDecision.recommended_action,
        confidence: fallbackDecision.confidence,
        reason: errorMessage,
        timestamp
      });

      return {
        success: false,
        fallback: true,
        decision: fallbackDecision,
        error: errorMessage
      };
    }
  }

  /**
   * Safe operational logging without secret or PII exposure.
   */
  private logOperation(params: {
    paymentId: string;
    status: 'SUCCESS' | 'FALLBACK';
    action: string;
    confidence: number;
    reason: string;
    timestamp: string;
  }) {
    console.log(
      `[RECOVERY_AGENT] ${params.timestamp} | payment=${params.paymentId} | status=${params.status} | action=${params.action} | conf=${params.confidence.toFixed(2)} | info="${params.reason.slice(0, 100)}"`
    );
  }
}

export const geminiRecoveryAgent = new GeminiRecoveryAgent();
