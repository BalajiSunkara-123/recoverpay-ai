/**
 * RecoverPay Payment Inspection & Security Audit Drawer
 * 
 * Professional security & operations inspector:
 * - Payment & Customer Metadata
 * - AI Diagnosis (Recommendation, Confidence, Reasoning, Advisory Disclaimer)
 * - Deterministic Policy Evaluation (8 Zero-Trust Rules Table)
 * - Bounded Tool Router Execution & Idempotency
 * - Outcome Verification (Ledger State Check: Tool Success != Recovery)
 * - Cryptographic Audit Chain (Append-only SHA-256 Hash Chain)
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Brain,
  Zap,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  Play,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Lock,
  ExternalLink,
  Clock
} from 'lucide-react';
import {
  Payment,
  Customer,
  PolicyRules,
  AuditEvent,
  AIAgentDecision,
  PolicyResult,
  ToolResult
} from '../types/index.ts';
import {
  fetchPaymentDetail,
  runAgentDiagnosis,
  evaluatePolicy,
  executeRecovery
} from '../lib/api.ts';

interface AuditDrawerProps {
  paymentId: string | null;
  onClose: () => void;
  onStateChanged: () => void;
}

export const AuditDrawer: React.FC<AuditDrawerProps> = ({
  paymentId,
  onClose,
  onStateChanged
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [policy, setPolicy] = useState<PolicyRules | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);

  // Pipeline State
  const [activeTab, setActiveTab] = useState<'lifecycle' | 'policy' | 'audit'>('lifecycle');
  const [aiDecision, setAiDecision] = useState<AIAgentDecision | null>(null);
  const [policyResult, setPolicyResult] = useState<PolicyResult | null>(null);
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);

  // Action Loaders
  const [actionRunning, setActionRunning] = useState<'diagnose' | 'evaluate' | 'execute' | null>(null);

  useEffect(() => {
    if (!paymentId) {
      setPayment(null);
      setCustomer(null);
      setAiDecision(null);
      setPolicyResult(null);
      setToolResult(null);
      return;
    }

    loadDetails(paymentId);
  }, [paymentId]);

  const loadDetails = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPaymentDetail(id);
      setPayment(data.payment);
      setCustomer(data.customer);
      setPolicy(data.policy);
      setAuditEvents(data.auditEvents);
    } catch (err: any) {
      setError(err.message || 'Failed to load payment details');
    } finally {
      setLoading(false);
    }
  };

  if (!paymentId) return null;

  const handleDiagnose = async () => {
    if (!payment) return;
    setActionRunning('diagnose');
    setError(null);
    try {
      const decision = await runAgentDiagnosis(payment.id);
      setAiDecision(decision);
      const pol = await evaluatePolicy(payment.id, decision);
      setPolicyResult(pol);
      await loadDetails(payment.id);
      onStateChanged();
    } catch (err: any) {
      setError(err.message || 'AI diagnosis failed');
    } finally {
      setActionRunning(null);
    }
  };

  const handleExecute = async () => {
    if (!payment) return;
    setActionRunning('execute');
    setError(null);
    try {
      const res = await executeRecovery(payment.id, {
        custom_decision: aiDecision || undefined
      });
      setToolResult(res.toolResult);
      setPolicyResult(res.policyResult);
      await loadDetails(payment.id);
      onStateChanged();
    } catch (err: any) {
      setError(err.message || 'Recovery execution failed');
    } finally {
      setActionRunning(null);
    }
  };

  // 8 Canonical Policy Rules Checklist
  const allPolicyRules = [
    {
      code: 'ALREADY_SUCCESSFUL',
      name: 'Duplicate Charge Prevention',
      desc: 'Block retry if payment already in captured status'
    },
    {
      code: 'CUSTOMER_OPTED_OUT',
      name: 'Customer Opt-Out Enforcement',
      desc: 'Enforce user privacy preferences against automated retries'
    },
    {
      code: 'MAX_RETRIES_EXCEEDED',
      name: 'Retry Limit Enforcement',
      desc: 'Cap automated attempts to configured merchant threshold'
    },
    {
      code: 'COOLDOWN_ACTIVE',
      name: 'Rate-Limiting Cooldown Window',
      desc: 'Enforce minimum delay between automated payment retries'
    },
    {
      code: 'AMOUNT_EXCEEDS_CAP',
      name: 'Financial Cap Guardrail',
      desc: 'Intercept high-value transactions (>₹50,000) for human review'
    },
    {
      code: 'LOW_CONFIDENCE',
      name: 'Confidence Floor Guardrail',
      desc: 'Require minimum 0.70 confidence before authorizing action'
    },
    {
      code: 'MALFORMED_OUTPUT',
      name: 'Schema Integrity Check',
      desc: 'Enforce finite values and valid schema on AI outputs'
    },
    {
      code: 'FATAL_DECLINED_CARD',
      name: 'Fatal Decline Interception',
      desc: 'Permanently block retries on hard card declines / fraud flags'
    }
  ];

  const violations = policyResult?.violations || [];
  const isCaptured = payment?.status === 'captured';

  // Derive comprehensive policy status and reason so that it is NEVER blank
  const isPolicyAllowed = policyResult ? policyResult.allowed : false;
  const isPolicyEscalated =
    (policyResult && !policyResult.allowed && policyResult.finalAction === 'ESCALATE') ||
    aiDecision?.recommended_action === 'ESCALATE' ||
    payment?.status === 'escalated' ||
    error !== null;
  const isPolicyBlocked = policyResult ? (!policyResult.allowed && !isPolicyEscalated) : false;

  const policyStatusDisplay = isPolicyAllowed
    ? 'ALLOWED'
    : isPolicyEscalated
    ? 'ESCALATED — FAIL CLOSED'
    : isPolicyBlocked
    ? 'BLOCKED'
    : 'PENDING EVALUATION';

  const policyReasonDisplay =
    violations.length > 0
      ? violations.map((v: any) => (typeof v === 'string' ? v : v.reason || v.rule)).join('; ')
      : isPolicyEscalated
      ? (error
          ? `Inference/Validation Failure: ${error}. Policy engine failed closed to human escalation.`
          : aiDecision?.reasoning || 'Safety invariant enforced: Low AI confidence or validation violation. Automated recovery blocked.')
      : isPolicyAllowed
      ? 'All 8 zero-trust safety guardrails passed.'
      : 'Awaiting AI diagnostic inference and policy gate check.';

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-[#0b0f19] border-l border-slate-800 shadow-2xl z-50 flex flex-col text-slate-200">
      {/* Top Header */}
      <div className="p-4 border-b border-slate-800 bg-[#0f172a] flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-slate-100">
              {paymentId}
            </span>
            {payment?.status && (
              <span
                className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                  payment.status === 'captured'
                    ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800/60'
                    : payment.status === 'failed'
                    ? 'bg-rose-950/50 text-rose-400 border border-rose-800/60'
                    : payment.status === 'escalated'
                    ? 'bg-amber-950/50 text-amber-400 border border-amber-800/60'
                    : 'bg-slate-800 text-slate-300 border border-slate-700'
                }`}
              >
                {payment.status.toUpperCase()}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-3">
            <span>
              Amount:{' '}
              <strong className="text-slate-200 font-mono">
                ₹{((payment?.amount || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </strong>
            </span>
            <span>•</span>
            <span>
              Failure:{' '}
              <strong className="text-slate-300 font-mono">
                {payment?.failure_code || 'N/A'}
              </strong>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => loadDetails(paymentId)}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Refresh"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Close Inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-900/50 text-xs">
        <button
          onClick={() => setActiveTab('lifecycle')}
          className={`flex-1 py-2.5 px-4 text-center font-medium transition-colors border-b-2 ${
            activeTab === 'lifecycle'
              ? 'border-blue-500 text-blue-400 bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Lifecycle & Execution
        </button>
        <button
          onClick={() => setActiveTab('policy')}
          className={`flex-1 py-2.5 px-4 text-center font-medium transition-colors border-b-2 ${
            activeTab === 'policy'
              ? 'border-blue-500 text-blue-400 bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Policy Rules (8)
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex-1 py-2.5 px-4 text-center font-medium transition-colors border-b-2 ${
            activeTab === 'audit'
              ? 'border-blue-500 text-blue-400 bg-slate-800/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Audit Ledger ({auditEvents.length})
        </button>
      </div>

      {/* Drawer Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {loading && !payment ? (
          <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span>Loading payment inspection data...</span>
          </div>
        ) : !payment ? (
          <div className="py-12 text-center text-slate-500">Payment details not found.</div>
        ) : (
          <>
            {error && (
              <div className="p-2.5 bg-rose-950/40 border border-rose-800/80 text-rose-300 rounded flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* TAB 1: LIFECYCLE & EXECUTION */}
            {activeTab === 'lifecycle' && (
              <div className="space-y-3.5">
                {/* 1. Payment & Customer Metadata */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Payment & Customer Metadata
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-[11px]">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Customer</span>
                      <span className="text-slate-200 font-medium">
                        {customer?.name || payment.customer_id}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Opted Out?</span>
                      <span
                        className={
                          customer?.opt_out ? 'text-rose-400 font-semibold' : 'text-emerald-400'
                        }
                      >
                        {customer?.opt_out ? 'YES (OPTED OUT)' : 'NO'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Attempts Made</span>
                      <span className="text-slate-200 font-medium">{payment.recovery_attempts}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[10px]">Error Code</span>
                      <span className="text-slate-200 font-medium">{payment.failure_code}</span>
                    </div>
                  </div>
                </div>

                {/* 2. AI Diagnosis Section */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-indigo-400" />
                      <span>AI Diagnosis (Gemini 3.8 Flash)</span>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                      ADVISORY ONLY — NO TOOL ACCESS
                    </span>
                  </div>

                  {aiDecision ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2 p-2 bg-slate-950/60 rounded border border-slate-800 text-[11px]">
                        <div>
                          <span className="text-slate-500 block text-[10px]">Recommended Action</span>
                          <span className="font-semibold text-blue-400">
                            {aiDecision.recommended_action}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Confidence</span>
                          <span className="font-mono text-slate-200 font-semibold">
                            {typeof aiDecision.confidence === 'number' ? `${(aiDecision.confidence * 100).toFixed(1)}%` : '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Category</span>
                          <span className="text-slate-300">{aiDecision.failure_category}</span>
                        </div>
                      </div>
                      <div className="text-[11px] text-slate-400 p-2 bg-slate-950/40 rounded border border-slate-800/80">
                        <strong className="text-slate-300">Reasoning:</strong> {aiDecision.reasoning}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between py-1">
                      <span className="text-slate-500 text-[11px]">
                        AI diagnosis not yet run for this session.
                      </span>
                      <button
                        onClick={handleDiagnose}
                        disabled={actionRunning !== null}
                        className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      >
                        {actionRunning === 'diagnose' ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Diagnosing...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>Run AI Diagnosis</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. Deterministic Policy Gate Section */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                      <span>Policy Evaluation Gate</span>
                    </div>
                    <span
                      className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                        isPolicyAllowed
                          ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60'
                          : isPolicyEscalated
                          ? 'text-amber-400 bg-amber-950/40 border-amber-800/60'
                          : isPolicyBlocked
                          ? 'text-rose-400 bg-rose-950/40 border-rose-800/60'
                          : 'text-slate-400 bg-slate-900 border-slate-800'
                      }`}
                    >
                      {policyStatusDisplay}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] text-slate-400 p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-medium">Policy Status:</span>
                        <strong
                          className={
                            isPolicyAllowed
                              ? 'text-emerald-400 font-mono'
                              : isPolicyEscalated
                              ? 'text-amber-400 font-mono'
                              : isPolicyBlocked
                              ? 'text-rose-400 font-mono'
                              : 'text-slate-400 font-mono'
                          }
                        >
                          {policyStatusDisplay}
                        </strong>
                      </div>
                      <div className="mt-1.5 text-[11px] text-slate-300 leading-relaxed">
                        <span className="text-slate-400 font-medium">Applicable Policy Reason: </span>
                        {policyReasonDisplay}
                      </div>
                      {violations.length > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 text-[11px] text-rose-400">
                          Specific Violations: {violations.map((v: any) => (typeof v === 'string' ? v : `${v.rule}: ${v.reason}`)).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 4. Tool Router & Execution */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Bounded Tool Router</span>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 font-mono">
                      IDEMPOTENCY PROTECTED
                    </span>
                  </div>

                  {toolResult ? (
                    <div className="space-y-1.5 font-mono text-[11px]">
                      <div className="p-2 bg-slate-950/60 rounded border border-slate-800 flex items-center justify-between">
                        <span className="text-slate-400">Tool Result</span>
                        <span
                          className={`font-semibold ${
                            toolResult.success ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {toolResult.success ? 'SUCCESS' : 'FAILED'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Tool: <strong className="text-slate-200">{toolResult.tool_name}</strong> · Mode:{' '}
                        <strong className="text-slate-200">{toolResult.execution_mode}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-500 py-1">
                      Ready for bounded execution. Enforces strict zero-trust gate.
                    </div>
                  )}
                </div>

                {/* 5. Outcome Verification */}
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Outcome Verification</span>
                    </div>
                    <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">
                      TOOL SUCCESS != RECOVERY
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Ledger State</span>
                      <span
                        className={`font-semibold uppercase font-mono ${
                          payment.status === 'captured'
                            ? 'text-emerald-400'
                            : payment.status === 'escalated'
                            ? 'text-amber-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {payment.status}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 block">Verified Captured?</span>
                      <span
                        className={`font-semibold ${
                          payment.status === 'captured' ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {payment.status === 'captured' ? 'YES (CAPTURED CONFIRMED)' : 'NO'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Execute Recovery Action Button */}
                <div className="pt-2">
                  <button
                    onClick={handleExecute}
                    disabled={actionRunning !== null || payment.status === 'captured'}
                    className={`w-full py-2.5 px-4 rounded text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                      payment.status === 'captured'
                        ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                    }`}
                  >
                    {actionRunning === 'execute' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Executing governed recovery pipeline...</span>
                      </>
                    ) : payment.status === 'captured' ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Payment already captured (retries prohibited)</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Execute Governed Recovery Pipeline</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: POLICY RULES (8) */}
            {activeTab === 'policy' && (
              <div className="space-y-3">
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs">
                  <div className="font-semibold text-slate-200 mb-1">
                    Deterministic Zero-Trust Policy Engine
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Every candidate action is evaluated against all 8 independent safety rules
                    without short-circuiting. Absolute safety precedence is enforced:
                    <strong className="text-slate-300"> STOP &gt; ESCALATE &gt; ALLOW</strong>.
                  </p>
                </div>

                {/* Clean Table of 8 Rules */}
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-slate-900/60">
                        <th className="py-2 px-3 font-medium">Policy Rule</th>
                        <th className="py-2 px-3 font-medium">Description</th>
                        <th className="py-2 px-3 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {allPolicyRules.map(rule => {
                        const isViolated = violations.some((v: any) =>
                          typeof v === 'string'
                            ? v.includes(rule.code)
                            : v.rule === rule.code || v.reason?.includes(rule.code)
                        );
                        return (
                          <tr key={rule.code} className="hover:bg-slate-900/40">
                            <td className="py-2.5 px-3 font-mono text-[11px] font-semibold text-slate-200">
                              {rule.code}
                            </td>
                            <td className="py-2.5 px-3 text-slate-400 text-[11px]">
                              {rule.desc}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border font-mono ${
                                  isViolated
                                    ? 'bg-rose-950/40 text-rose-400 border-rose-800/60'
                                    : 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60'
                                }`}
                              >
                                {isViolated ? 'BLOCK' : 'PASS'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: AUDIT LEDGER */}
            {activeTab === 'audit' && (
              <div className="space-y-3">
                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-200">Cryptographic Audit Ledger</div>
                    <p className="text-slate-400 text-[11px]">
                      Append-only SHA-256 tamper-evident event chain for payment {paymentId}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-300 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    {auditEvents.length} events
                  </span>
                </div>

                <div className="space-y-2.5">
                  {auditEvents.map(evt => (
                    <div
                      key={evt.event_id}
                      className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg space-y-1.5 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-blue-400">{evt.event_type}</span>
                        <span className="text-slate-500 text-[10px]">
                          {new Date(evt.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-sans">
                        Actor: <span className="text-slate-300 font-mono">{evt.actor}</span> ·
                        Decision:{' '}
                        <span
                          className={
                            evt.policy_decision === 'ALLOWED'
                              ? 'text-emerald-400 font-semibold'
                              : 'text-rose-400 font-semibold'
                          }
                        >
                          {evt.policy_decision}
                        </span>
                      </div>
                      {evt.tool_called && (
                        <div className="text-[11px] text-slate-400 font-sans">
                          Tool: <span className="text-slate-200 font-mono">{evt.tool_called}</span> (
                          {evt.execution_mode})
                        </div>
                      )}
                      <div className="pt-1.5 border-t border-slate-800/80 text-[10px] text-slate-500 flex flex-col gap-0.5">
                        <div className="truncate">
                          Prev:{' '}
                          <span className="text-slate-400">{evt.previous_hash || '00000000'}</span>
                        </div>
                        <div className="truncate">
                          Curr: <span className="text-blue-300">{evt.current_hash}</span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {auditEvents.length === 0 && (
                    <div className="p-6 bg-slate-900/40 border border-slate-800 rounded-lg text-center space-y-3">
                      <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                        <Clock className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-200">Zero Audit Events Recorded</h4>
                        <p className="text-[11px] text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
                          This transaction failed at the payment gateway and is currently staged in the operational datastore. No autonomous recovery operations, policy evaluations, or bounded tool dispatches have been executed for it yet.
                        </p>
                      </div>
                      <div className="text-[10px] text-slate-500 bg-slate-950/70 p-2.5 rounded border border-slate-800/80 max-w-sm mx-auto">
                        Cryptographic SHA-256 ledger records will be immutably appended here when an operator runs AI Diagnosis or executes a recovery strategy.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
