/**
 * RecoverPay Recovery Funnel Visualization
 * 
 * Demonstrates the conversion drop-off across policy & outcome verification gates.
 * Distinguishes AI recommendations vs. policy-approved vs. executed vs. captured.
 */

import React from 'react';
import { RecoveryFunnelData } from '../lib/api.ts';
import { CheckCircle2, ShieldAlert, ArrowRight, Activity } from 'lucide-react';

interface RecoveryFunnelProps {
  funnel: RecoveryFunnelData;
}

export const RecoveryFunnel: React.FC<RecoveryFunnelProps> = ({ funnel }) => {
  const total = Math.max(funnel.telemetry_failed, 1);

  const stages = [
    {
      label: 'Telemetry Ingested',
      count: funnel.telemetry_failed,
      sub: 'Total failed payment events',
      pct: 100,
      barColor: 'bg-slate-600'
    },
    {
      label: 'AI Diagnosed',
      count: funnel.ai_diagnosed,
      sub: 'Gemini reasoning performed (advisory)',
      pct: Math.round((funnel.ai_diagnosed / total) * 100),
      barColor: 'bg-indigo-600'
    },
    {
      label: 'Policy Evaluated',
      count: funnel.policy_evaluated,
      sub: 'Passed to 8-rule deterministic engine',
      pct: Math.round((funnel.policy_evaluated / total) * 100),
      barColor: 'bg-blue-600'
    },
    {
      label: 'Policy Approved',
      count: funnel.policy_approved,
      sub: `Approved for execution (${funnel.policy_blocked} blocked)`,
      pct: Math.round((funnel.policy_approved / total) * 100),
      barColor: 'bg-sky-600'
    },
    {
      label: 'Tool Dispatched',
      count: funnel.tool_executed,
      sub: 'Dispatched through Bounded Tool Router',
      pct: Math.round((funnel.tool_executed / total) * 100),
      barColor: 'bg-teal-600'
    },
    {
      label: 'Verified Captured',
      count: funnel.recovered,
      sub: 'Status = captured with confirmed bank capture',
      pct: Math.round((funnel.recovered / total) * 100),
      barColor: 'bg-emerald-600'
    }
  ];

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-3.5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Recovery Pipeline Conversion
            </h2>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            Zero-Trust Drop-off
          </span>
        </div>

        <div className="space-y-2.5">
          {stages.map((st, idx) => (
            <div key={st.label} className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-500 font-mono">0{idx + 1}</span>
                  <span className="font-medium text-slate-300">{st.label}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-slate-400">{st.count}</span>
                  <span className="text-slate-200 font-semibold w-9 text-right">{st.pct}%</span>
                </div>
              </div>

              <div className="w-full bg-slate-900 rounded-sm h-1.5 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${st.barColor}`}
                  style={{ width: `${Math.min(Math.max(st.pct, 2), 100)}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Conversion Summary Stats */}
      <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800 text-center text-xs">
        <div className="p-2 bg-slate-900/60 border border-slate-800 rounded">
          <div className="text-[10px] text-slate-400 uppercase font-medium">Recovered</div>
          <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{funnel.recovered}</div>
        </div>
        <div className="p-2 bg-slate-900/60 border border-slate-800 rounded">
          <div className="text-[10px] text-slate-400 uppercase font-medium">Policy Blocked</div>
          <div className="text-sm font-bold text-rose-400 font-mono mt-0.5">{funnel.policy_blocked}</div>
        </div>
        <div className="p-2 bg-slate-900/60 border border-slate-800 rounded">
          <div className="text-[10px] text-slate-400 uppercase font-medium">Escalated to Ops</div>
          <div className="text-sm font-bold text-amber-400 font-mono mt-0.5">
            {funnel.telemetry_failed - funnel.recovered}
          </div>
        </div>
      </div>
    </div>
  );
};
