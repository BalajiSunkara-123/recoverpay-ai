/**
 * RecoverPay Demo Scenarios Operations Panel
 * 
 * Compact, professional table of the 5 canonical test fixtures:
 * A: Transient Failure → ALLOWED → RECOVERED
 * B: Persistent Failure → MAX_RETRIES_EXCEEDED → ESCALATED
 * C: High Value + Opt Out → BLOCKED → ZERO TOOL EXECUTION
 * D: Malformed AI Response → SCHEMA_BREACH → FAIL-CLOSED
 * E: Already Captured → ALREADY_SUCCESSFUL → STOPPED
 */

import React, { useState } from 'react';
import { Play, Loader2, AlertCircle, CheckCircle2, ShieldAlert, AlertTriangle, Bug, Lock, Zap, Cpu } from 'lucide-react';
import { runDemoScenario, DemoTraceResponse } from '../lib/api.ts';

interface DemoScenariosProps {
  onScenarioExecuted: (trace: DemoTraceResponse) => void;
  onRefreshNeeded: () => void;
  onOpenJudgeDemo?: (mode: 'recovery' | 'safety' | 'razorpay_test') => void;
}

export const DemoScenarios: React.FC<DemoScenariosProps> = ({
  onScenarioExecuted,
  onRefreshNeeded,
  onOpenJudgeDemo
}) => {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastExecutedId, setLastExecutedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scenarios = [
    {
      id: 'scenario_a',
      letter: 'A',
      title: 'Transient Bank Downtime',
      paymentId: 'pay_demo_transient_01',
      amount: '₹2,499',
      failure: 'BANK_SYSTEM_BUSY (503)',
      description: 'Network spike during bank switch outage. AI identifies transient error.',
      policyDecision: 'ALLOWED',
      policyColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
      expectedOutcome: 'RECOVERED',
      outcomeColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
      detail: 'Retry executed → verified captured status'
    },
    {
      id: 'scenario_b',
      letter: 'B',
      title: 'Persistent Failure & Retry Cap',
      paymentId: 'pay_demo_persistent_02',
      amount: '₹4,999',
      failure: 'LIMIT_EXCEEDED',
      description: 'Card limit hit repeatedly. Recovery attempts reach policy ceiling (max: 2).',
      policyDecision: 'BLOCKED (MAX_RETRIES)',
      policyColor: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
      expectedOutcome: 'ESCALATED',
      outcomeColor: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
      detail: 'Further automated retries suppressed → routed to Ops'
    },
    {
      id: 'scenario_c',
      letter: 'C',
      title: 'High Value + Customer Opt-Out',
      paymentId: 'pay_demo_highvalue_03',
      amount: '₹85,000',
      failure: 'NETWORK_TIMEOUT',
      description: 'High transaction value exceeds ₹50,000 cap; customer has opted out of retries.',
      policyDecision: 'BLOCKED (OPT_OUT & CAP)',
      policyColor: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
      expectedOutcome: 'STOPPED / ZERO EXECUTION',
      outcomeColor: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
      detail: 'Zero financial tool execution. Strictly intercepted.'
    },
    {
      id: 'scenario_d',
      letter: 'D',
      title: 'Malformed AI Response',
      paymentId: 'pay_demo_transient_01',
      amount: '₹2,499',
      failure: 'SYNTHETIC_LLM_CORRUPTION',
      description: 'AI model returns corrupted payload with non-finite values (NaN / Infinity).',
      policyDecision: 'SCHEMA_REJECT',
      policyColor: 'text-blue-400 bg-blue-950/40 border-blue-800/60',
      expectedOutcome: 'FAIL-CLOSED (ESCALATE)',
      outcomeColor: 'text-blue-400 bg-blue-950/40 border-blue-800/60',
      detail: 'Schema validator rejects payload → zero tool dispatch'
    },
    {
      id: 'scenario_e',
      letter: 'E',
      title: 'Already Captured Payment',
      paymentId: 'pay_demo_captured_05',
      amount: '₹1,299',
      failure: 'NONE (STATUS: CAPTURED)',
      description: 'Duplicate webhook or erroneous retry sent for an already-settled payment.',
      policyDecision: 'BLOCKED (ALREADY_SUCCESSFUL)',
      policyColor: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
      expectedOutcome: 'STOPPED',
      outcomeColor: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
      detail: 'Rule 01 forces immediate STOP → zero duplicate charges'
    }
  ];

  const handleRun = async (id: string) => {
    setRunningId(id);
    setError(null);
    try {
      const trace = await runDemoScenario(id);
      setLastExecutedId(id);
      onScenarioExecuted(trace);
      onRefreshNeeded();
    } catch (err: any) {
      setError(err.message || 'Demo execution failed');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span>Demo Scenarios</span>
            <span className="text-[11px] font-normal text-slate-400">
              — Deterministic pipeline verification test cases (A–E)
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
            SIMULATION / TEST MODE
          </span>
          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
            ZERO REAL CHARGES
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-2.5 p-2 bg-rose-950/40 border border-rose-800/80 text-rose-300 text-xs rounded flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Judge Pitch Quick-Launch Bar */}
      {onOpenJudgeDemo && (
        <div className="mb-3 p-2.5 bg-gradient-to-r from-cyan-950/40 via-slate-900 to-fuchsia-950/40 border border-cyan-500/40 rounded flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            <span className="text-xs text-slate-200 font-mono">
              <strong className="text-cyan-400">JUDGE DEMO MODE:</strong> Deterministic 3–5 min end-to-end presentation walkthrough
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onOpenJudgeDemo('recovery')}
              className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
            >
              <Zap className="w-3.5 h-3.5 fill-black" />
              <span>RUN JUDGE DEMO</span>
            </button>
            <button
              onClick={() => onOpenJudgeDemo('safety')}
              className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-fuchsia-300 border border-fuchsia-600/70 rounded text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-fuchsia-400" />
              <span>SAFETY BLOCK (C)</span>
            </button>
            <button
              onClick={() => onOpenJudgeDemo('razorpay_test')}
              className="px-2.5 py-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-bold rounded text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>RAZORPAY TEST (MODE 2)</span>
            </button>
          </div>
        </div>
      )}

      {/* Compact Scenario Rows */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
              <th className="py-2 px-2.5 font-medium w-8">#</th>
              <th className="py-2 px-2.5 font-medium">Scenario</th>
              <th className="py-2 px-2.5 font-medium">Target Payment</th>
              <th className="py-2 px-2.5 font-medium">Description</th>
              <th className="py-2 px-2.5 font-medium">Policy Decision</th>
              <th className="py-2 px-2.5 font-medium">Expected Outcome</th>
              <th className="py-2 px-2.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {scenarios.map(sc => {
              const isRunning = runningId === sc.id;
              const isLast = lastExecutedId === sc.id;
              return (
                <tr
                  key={sc.id}
                  className={`transition-colors ${
                    isLast ? 'bg-blue-950/20' : 'hover:bg-slate-900/50'
                  }`}
                >
                  <td className="py-2.5 px-2.5 font-semibold text-slate-400">{sc.letter}</td>
                  <td className="py-2.5 px-2.5">
                    <div className="font-medium text-slate-200">{sc.title}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{sc.failure}</div>
                  </td>
                  <td className="py-2.5 px-2.5 font-mono text-[11px]">
                    <div className="text-slate-300">{sc.paymentId}</div>
                    <div className="text-slate-500">{sc.amount}</div>
                  </td>
                  <td className="py-2.5 px-2.5 text-slate-400 text-[11px] max-w-xs">
                    {sc.description}
                  </td>
                  <td className="py-2.5 px-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${sc.policyColor}`}>
                      {sc.policyDecision}
                    </span>
                  </td>
                  <td className="py-2.5 px-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${sc.outcomeColor}`}>
                      {sc.expectedOutcome}
                    </span>
                    <div className="text-[10px] text-slate-500 mt-0.5">{sc.detail}</div>
                  </td>
                  <td className="py-2.5 px-2.5 text-right">
                    <button
                      onClick={() => handleRun(sc.id)}
                      disabled={isRunning}
                      className="px-2.5 py-1 rounded text-[11px] font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white disabled:text-slate-500 transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Running...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Run Scenario</span>
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
