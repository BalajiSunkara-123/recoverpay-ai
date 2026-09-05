/**
 * RecoverPay Architecture Pipeline Process Indicator
 * 
 * Visualizes the zero-trust execution boundary:
 * Telemetry → AI Diagnosis → Validation → Policy → Execution → Verification → Audit
 * Concept: AI recommends → Policy decides → Router executes → Verification proves → Ledger records
 */

import React from 'react';
import {
  Activity,
  Brain,
  CheckSquare,
  ShieldCheck,
  Cpu,
  Zap,
  CheckCircle2,
  FileText,
  ChevronRight
} from 'lucide-react';

interface ArchitecturePipelineProps {
  activeStage?: 'telemetry' | 'gemini' | 'validation' | 'policy' | 'router' | 'execution' | 'verification' | 'audit' | null;
}

export const ArchitecturePipeline: React.FC<ArchitecturePipelineProps> = ({ activeStage }) => {
  const stages = [
    {
      id: 'telemetry',
      name: 'Telemetry',
      sub: 'Sanitized Data',
      icon: Activity,
      hint: 'Ground-truth isolated'
    },
    {
      id: 'gemini',
      name: 'AI Diagnosis',
      sub: 'Gemini 3.8 Flash',
      icon: Brain,
      hint: 'Advisory only (no tools)'
    },
    {
      id: 'validation',
      name: 'Validation',
      sub: 'Schema Guard',
      icon: CheckSquare,
      hint: 'Fails closed on NaN'
    },
    {
      id: 'policy',
      name: 'Policy Engine',
      sub: '8 Zero-Trust Rules',
      icon: ShieldCheck,
      hint: 'STOP > ESCALATE > ALLOW'
    },
    {
      id: 'router',
      name: 'Bounded Router',
      sub: 'Idempotency Lock',
      icon: Cpu,
      hint: 'Requires policy approval'
    },
    {
      id: 'execution',
      name: 'Execution',
      sub: 'Test / Sim Mode',
      icon: Zap,
      hint: 'Zero production charges'
    },
    {
      id: 'verification',
      name: 'Verification',
      sub: 'Capture Check',
      icon: CheckCircle2,
      hint: 'API success != Recovery'
    },
    {
      id: 'audit',
      name: 'Audit Ledger',
      sub: 'SHA-256 Chain',
      icon: FileText,
      hint: 'Append-only ledger'
    }
  ];

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-3">
      {/* Top Banner: Architectural Invariant */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800/80 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          <span className="font-semibold text-slate-200">Execution Pipeline Architecture</span>
          <span className="text-slate-500 text-[11px] hidden md:inline">
            — Zero-trust boundary with deterministic policy gate
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="text-slate-300 font-medium">Core Invariant:</span>
          <span className="text-slate-400 font-mono text-[11px]">
            AI recommends <span className="text-slate-600">→</span> Policy decides <span className="text-slate-600">→</span> Router executes <span className="text-slate-600">→</span> Verification proves <span className="text-slate-600">→</span> Ledger records
          </span>
        </div>
      </div>

      {/* Horizontal Steps Indicator */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5 items-stretch">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isActive = activeStage === stage.id;
          return (
            <div key={stage.id} className="relative flex items-center">
              <div
                className={`w-full p-2 rounded border transition-colors flex flex-col justify-between ${
                  isActive
                    ? 'bg-blue-950/40 border-blue-500/80 text-blue-200 ring-1 ring-blue-500/30'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                    <span className="text-[12px] font-medium truncate">{stage.name}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">0{idx + 1}</span>
                </div>
                <div className="text-[11px] text-slate-400 truncate">{stage.sub}</div>
                <div className="text-[10px] text-slate-500 truncate mt-0.5">{stage.hint}</div>
              </div>

              {idx < stages.length - 1 && (
                <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-slate-700 pointer-events-none">
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
