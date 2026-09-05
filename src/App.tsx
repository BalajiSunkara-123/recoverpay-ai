/**
 * RecoverPay Merchant Recovery Console
 * 
 * Professional Fintech Operations Console:
 * - Environment safety warning banner
 * - Header with system operational status and controls
 * - 6-metric compact operational KPI strip
 * - Horizontal zero-trust execution pipeline process indicator
 * - Two-column workspace: Recovery Operations Table (Left) + System Activity Stream (Right)
 * - Interactive Demo Scenarios benchmark panel
 * - Side-by-side Recovery Funnel & Evaluation Comparison Matrix
 * - Deep Security & Audit Inspection Drawer
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  RefreshCw,
  RotateCcw,
  Zap,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FileText
} from 'lucide-react';
import {
  fetchDashboardMetrics,
  fetchPayments,
  resetDataset,
  DashboardMetrics,
  RecoveryFunnelData,
  PaymentListItem,
  DemoTraceResponse
} from './lib/api.ts';
import { PaymentTable } from './components/PaymentTable.tsx';
import { ArchitecturePipeline } from './components/ArchitecturePipeline.tsx';
import { DemoScenarios } from './components/DemoScenarios.tsx';
import { RecoveryFunnel } from './components/RecoveryFunnel.tsx';
import { EvaluationMatrix } from './components/EvaluationMatrix.tsx';
import { AuditDrawer } from './components/AuditDrawer.tsx';
import { SystemActivityFeed, SystemActivityItem } from './components/SystemActivityFeed.tsx';
import { JudgeDemoModal } from './components/JudgeDemoModal.tsx';

export default function App() {
  // Global Metrics & Funnel State
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [funnel, setFunnel] = useState<RecoveryFunnelData | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Payments Table State
  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [offset, setOffset] = useState(0);
  const limit = 10;

  // Selected Payment for Inspection Drawer
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);

  // Judge Demo Presentation Walkthrough State
  const [judgeDemoOpen, setJudgeDemoOpen] = useState<boolean>(false);
  const [judgeDemoMode, setJudgeDemoMode] = useState<'recovery' | 'safety' | 'duplicate'>('recovery');

  const handleOpenJudgeDemo = (mode: 'recovery' | 'safety' = 'recovery') => {
    setJudgeDemoMode(mode);
    setJudgeDemoOpen(true);
  };

  // Active Pipeline Stage for Visual Indicator
  const [activePipelineStage, setActivePipelineStage] = useState<
    'telemetry' | 'gemini' | 'validation' | 'policy' | 'router' | 'execution' | 'verification' | 'audit' | null
  >(null);

  // System Activity Stream
  const [activities, setActivities] = useState<SystemActivityItem[]>([
    {
      id: 'init-1',
      timestamp: new Date(Date.now() - 120000).toLocaleTimeString(),
      type: 'ai',
      title: 'AI diagnosis completed',
      detail: 'Confidence: 94.2% · Transient downtime identified',
      paymentId: 'pay_demo_transient_01',
      statusBadge: 'RETRY',
      statusColor: 'text-blue-400 bg-blue-950/40 border-blue-800'
    },
    {
      id: 'init-2',
      timestamp: new Date(Date.now() - 118000).toLocaleTimeString(),
      type: 'policy',
      title: 'Policy evaluation ALLOWED',
      detail: '8 of 8 zero-trust rules evaluated successfully',
      paymentId: 'pay_demo_transient_01',
      statusBadge: 'ALLOWED',
      statusColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800'
    },
    {
      id: 'init-3',
      timestamp: new Date(Date.now() - 117000).toLocaleTimeString(),
      type: 'dispatch',
      title: 'Simulation retry dispatched',
      detail: 'Idempotency token validated · Router gate open',
      paymentId: 'pay_demo_transient_01',
      statusBadge: 'DISPATCHED',
      statusColor: 'text-amber-400 bg-amber-950/40 border-amber-800'
    },
    {
      id: 'init-4',
      timestamp: new Date(Date.now() - 115000).toLocaleTimeString(),
      type: 'capture',
      title: 'Capture verified',
      detail: 'Payment status = captured · ₹2,499 recovered',
      paymentId: 'pay_demo_transient_01',
      statusBadge: 'CAPTURED',
      statusColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800'
    },
    {
      id: 'init-5',
      timestamp: new Date(Date.now() - 114000).toLocaleTimeString(),
      type: 'audit',
      title: 'Audit event appended',
      detail: 'SHA-256 block linked · Immutable ledger entry',
      paymentId: 'pay_demo_transient_01',
      statusBadge: 'LEDGER_OK',
      statusColor: 'text-slate-400 bg-slate-800 border-slate-700'
    }
  ]);

  // Load Metrics & Funnel
  const loadMetrics = useCallback(async () => {
    try {
      setMetricsLoading(true);
      const data = await fetchDashboardMetrics();
      setMetrics(data.metrics);
      setFunnel(data.funnel);
    } catch (err) {
      console.error('Failed to load metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  // Load Payments
  const loadPayments = useCallback(async () => {
    try {
      setTableLoading(true);
      const data = await fetchPayments({
        filter,
        search,
        sort,
        offset,
        limit
      });
      setPayments(data.payments);
      setPaymentsTotal(data.total);
    } catch (err) {
      console.error('Failed to load payments:', err);
    } finally {
      setTableLoading(false);
    }
  }, [filter, search, sort, offset, limit]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const handleRefreshAll = () => {
    loadMetrics();
    loadPayments();
  };

  const handleResetDataset = async () => {
    if (confirm('Reset synthetic dataset to clean baseline state?')) {
      try {
        await resetDataset();
        handleRefreshAll();
        setActivities(prev => [
          {
            id: `reset-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString(),
            type: 'audit',
            title: 'Dataset reset to baseline',
            detail: '600 synthetic payment records reloaded',
            statusBadge: 'RESET_OK',
            statusColor: 'text-blue-400 bg-blue-950/40 border-blue-800'
          },
          ...prev
        ]);
      } catch (err) {
        console.error('Failed to reset dataset:', err);
      }
    }
  };

  // Handle Demo Scenario Completed
  const handleDemoExecuted = (trace: DemoTraceResponse) => {
    setSelectedPaymentId(trace.payment.id);
    setActivePipelineStage('verification');
    setTimeout(() => setActivePipelineStage(null), 3000);

    const now = new Date().toLocaleTimeString();
    const policyStatus = trace.policyResult.allowed ? 'ALLOWED' : 'BLOCKED';
    const violationSummary = trace.policyResult.violations.length > 0
      ? trace.policyResult.violations.map(v => typeof v === 'string' ? v : (v.reason || v.rule)).join(', ')
      : 'All zero-trust safety rules passed';
    const agentConfidence = typeof trace.aiDecision.confidence === 'number' ? (trace.aiDecision.confidence * 100).toFixed(0) : '0';
    const agentCategory = trace.aiDecision.diagnosis || (trace.aiDecision as any).failure_category || 'Diagnosed';

    const newEvents: SystemActivityItem[] = [
      {
        id: `demo-${Date.now()}-1`,
        timestamp: now,
        type: 'ai',
        title: `AI diagnosis: ${trace.aiDecision.recommended_action}`,
        detail: `Confidence: ${agentConfidence}% · ${agentCategory}`,
        paymentId: trace.payment.id,
        statusBadge: trace.aiDecision.recommended_action,
        statusColor: 'text-blue-400 bg-blue-950/40 border-blue-800'
      },
      {
        id: `demo-${Date.now()}-2`,
        timestamp: now,
        type: 'policy',
        title: `Policy decision: ${policyStatus}`,
        detail: violationSummary,
        paymentId: trace.payment.id,
        statusBadge: policyStatus,
        statusColor: trace.policyResult.allowed
          ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800'
          : 'text-rose-400 bg-rose-950/40 border-rose-800'
      },
      {
        id: `demo-${Date.now()}-3`,
        timestamp: now,
        type: trace.outcomeVerification.recovered ? 'capture' : 'dispatch',
        title: trace.outcomeVerification.recovered ? 'Capture verified' : `Execution: ${trace.toolResult.execution_mode}`,
        detail: trace.outcomeVerification.message,
        paymentId: trace.payment.id,
        statusBadge: trace.outcomeVerification.recovered ? 'RECOVERED' : !trace.policyResult.allowed ? 'BLOCKED' : 'ESCALATED',
        statusColor: trace.outcomeVerification.recovered
          ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800'
          : 'text-amber-400 bg-amber-950/40 border-amber-800'
      }
    ];

    setActivities(prev => [...newEvents, ...prev.slice(0, 30)]);
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-200 flex flex-col antialiased">
      {/* 1. Global Safety & Environment Warning Banner */}
      <div className="bg-[#0f172a] border-b border-slate-800 text-xs px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-2 text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          <span className="font-medium text-[12px]">
            TEST ENVIRONMENT — No production payments are processed. Zero real bank charges. (Razorpay Test API / Simulation)
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Razorpay Test Mode
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
            Simulated Recovery Active
          </span>
          <button
            onClick={handleResetDataset}
            className="text-slate-400 hover:text-rose-400 underline transition-colors cursor-pointer text-xs"
          >
            Reset Dataset
          </button>
        </div>
      </div>

      {/* 2. Operations Header */}
      <header className="border-b border-slate-800 bg-[#0f172a]/90 backdrop-blur px-4 py-3 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-blue-950 border border-blue-700/60 flex items-center justify-center">
              <Zap className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-slate-100">
                  RecoverPay
                </h1>
                <span className="text-[11px] px-2 py-0.5 rounded font-medium bg-slate-800 text-slate-300 border border-slate-700">
                  Payment Operations Console
                </span>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-400 bg-blue-950/60 border border-blue-800/80 px-2 py-0.5 rounded">
                  Live Operations
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Policy-governed autonomous revenue recovery for Razorpay merchants · Live operational datastore ({paymentsTotal} records)
              </p>
            </div>
          </div>

          {/* System Status Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span className="text-slate-400">System:</span>
              <span className="text-slate-200 font-medium">Operational</span>
            </div>
            <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 flex items-center gap-1.5">
              <span className="text-slate-400">Gemini:</span>
              <span className="text-slate-200 font-medium">Ready (Advisory)</span>
            </div>
            <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 flex items-center gap-1.5">
              <span className="text-slate-400">Policy:</span>
              <span className="text-slate-200 font-medium">8 Active Rules</span>
            </div>
            <button
              onClick={handleRefreshAll}
              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded transition-colors"
              title="Refresh All"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-4">
        {/* Judge Demo Banner: One-Click Presentation Launcher */}
        {/*<div className="bg-gradient-to-r from-[#0c1322] via-[#101b33] to-[#150d24] border-2 border-cyan-500/60 rounded-lg p-3 sm:p-3.5 shadow-lg flex flex-col md:flex-row items-center justify-between gap-3 glitch-box-glow">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded bg-cyan-950/80 border border-cyan-400 flex items-center justify-center text-cyan-400 shrink-0">
              <Zap className="w-5 h-5 fill-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold tracking-wider text-cyan-400 glitch-cyan-magenta">
                  JUDGE DEMO WORKFLOW // 3–5 MINUTE PRESENTATION
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-500/60 font-semibold">
                  DETERMINISTIC
                </span>
              </div>
              <p className="text-xs text-slate-300 font-sans mt-0.5">
                Walk the judging panel through the complete zero-trust recovery lifecycle: Telemetry → AI Diagnosis → Policy Gate → Tool Router → Outcome Verification → Cryptographic Ledger.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
            <button
              onClick={() => handleOpenJudgeDemo('recovery')}
              className="flex-1 md:flex-none px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded text-xs transition-all shadow-lg shadow-cyan-500/30 flex items-center justify-center gap-2 cursor-pointer font-mono"
            >
              <Zap className="w-4 h-4 fill-black" />
              <span>RUN JUDGE DEMO</span>
            </button>
            <button
              onClick={() => handleOpenJudgeDemo('safety')}
              className="flex-1 md:flex-none px-3.5 py-2 bg-slate-900 hover:bg-fuchsia-950/80 text-fuchsia-300 border border-fuchsia-600/70 hover:border-fuchsia-500 rounded text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer font-mono"
            >
              <ShieldAlert className="w-4 h-4 text-fuchsia-400" />
              <span>SAFETY BLOCK (₹85k)</span>
            </button>
          </div>
        </div>*/}

        {/* 3. COMPACT KPI STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* 1. Failed Payments */}
          <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium block truncate">Failed Payments</span>
            <span className="text-xl font-semibold text-slate-100 block mt-1 font-mono">
              {metricsLoading ? '—' : metrics?.total_failed_payments || 0}
            </span>
            <span className="text-[10px] text-slate-500 block truncate mt-0.5">Ingested Failures</span>
          </div>

          {/* 2. Recoverable */}
          <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium block truncate">Recoverable</span>
            <span className="text-xl font-semibold text-blue-400 block mt-1 font-mono">
              {metricsLoading ? '—' : metrics?.recoverable_payments || 0}
            </span>
            <span className="text-[10px] text-slate-500 block truncate mt-0.5">Eligible Candidates</span>
          </div>

          {/* 3. Live Recovery Rate */}
          <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium block truncate">Live Recovery Rate</span>
            <span className="text-xl font-semibold text-emerald-400 block mt-1 font-mono">
              {metricsLoading ? '—' : `${metrics?.recovery_rate_percent || 0}%`}
            </span>
            <span className="text-[10px] text-slate-500 block truncate mt-0.5" title="Live operational rate. Controlled 600-record benchmark is in Evaluation Matrix.">
              Of Live Eligible
            </span>
          </div>

          {/* 4. Revenue at Risk */}
          <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium block truncate">Revenue at Risk</span>
            <span className="text-xl font-semibold text-amber-400 block mt-1 font-mono">
              {metricsLoading ? '—' : `₹${((metrics?.revenue_at_risk_inr || 0) / 1000).toFixed(1)}k`}
            </span>
            <span className="text-[10px] text-slate-500 block truncate mt-0.5">Unrecovered Amount</span>
          </div>

          {/* 5. Revenue Recovered */}
          <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium block truncate">Revenue Recovered</span>
            <span className="text-xl font-semibold text-emerald-400 block mt-1 font-mono">
              {metricsLoading ? '—' : `₹${((metrics?.revenue_recovered_inr || 0) / 1000).toFixed(1)}k`}
            </span>
            <span className="text-[10px] text-slate-500 block truncate mt-0.5">Verified Captured</span>
          </div>

          {/* 6. Escalations */}
          <div className="bg-[#0f172a] p-3 rounded-lg border border-slate-800">
            <span className="text-[11px] text-slate-400 font-medium block truncate">Escalations</span>
            <span className="text-xl font-semibold text-slate-300 block mt-1 font-mono">
              {metricsLoading ? '—' : `${metrics?.total_escalated_payments || 0}`}
            </span>
            <span className="text-[10px] text-slate-500 block truncate mt-0.5">Routed to Ops</span>
          </div>
        </div>

        {/* Live Operations Contextual Notice */}
        <div className="px-3.5 py-2 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-300 font-medium font-mono text-[10px] border border-blue-800/60 shrink-0">
              LIVE OPERATIONS
            </span>
            <span>
              Dashboard telemetry reflects the dynamic merchant datastore (<strong className="text-slate-200">{paymentsTotal} records</strong>, including interactive demo runs).
            </span>
          </div>
          <span className="text-slate-400 text-[11px] shrink-0">
            The controlled <strong className="text-slate-200">600-record benchmark</strong> is isolated in the <strong className="text-blue-400">Evaluation Matrix</strong> tab.
          </span>
        </div>

        {/* 4. Architecture Pipeline (Horizontal Process Indicator) */}
        <ArchitecturePipeline activeStage={activePipelineStage} />

        {/* 5. TWO-COLUMN OPERATIONAL WORKSPACE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column: Recovery Operations Table (approx 68% width) */}
          <div className="lg:col-span-8">
            <PaymentTable
              payments={payments}
              total={paymentsTotal}
              loading={tableLoading}
              filter={filter}
              onFilterChange={f => {
                setFilter(f);
                setOffset(0);
              }}
              search={search}
              onSearchChange={s => {
                setSearch(s);
                setOffset(0);
              }}
              sort={sort}
              onSortChange={st => {
                setSort(st);
                setOffset(0);
              }}
              offset={offset}
              limit={limit}
              onPageChange={setOffset}
              onSelectPayment={id => setSelectedPaymentId(id)}
              selectedPaymentId={selectedPaymentId}
              onRefresh={loadPayments}
            />
          </div>

          {/* Right Column: System Activity Feed (approx 32% width) */}
          <div className="lg:col-span-4">
            <SystemActivityFeed
              activities={activities}
              onSelectPayment={id => setSelectedPaymentId(id)}
            />
          </div>
        </div>

        {/* 6. Demo Scenarios Panel */}
        <DemoScenarios
          onScenarioExecuted={handleDemoExecuted}
          onRefreshNeeded={handleRefreshAll}
          onOpenJudgeDemo={handleOpenJudgeDemo}
        />

        {/* 7. Bottom Grid: Recovery Funnel & Strategy Benchmark Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-5">
            {funnel ? (
              <RecoveryFunnel funnel={funnel} />
            ) : (
              <div className="p-8 text-center text-slate-500 bg-[#0f172a] rounded-lg border border-slate-800 text-xs">
                Loading Funnel Data...
              </div>
            )}
          </div>
          <div className="lg:col-span-7">
            <EvaluationMatrix />
          </div>
        </div>
      </main>

      {/* 8. Judge Demo Walkthrough Modal */}
      <JudgeDemoModal
        isOpen={judgeDemoOpen}
        initialMode={judgeDemoMode}
        onClose={() => setJudgeDemoOpen(false)}
        onOpenAuditDrawer={(id) => {
          setJudgeDemoOpen(false);
          setSelectedPaymentId(id);
        }}
        onStateChanged={handleRefreshAll}
      />

      {/* 9. Deep Security & Audit Inspection Drawer */}
      <AuditDrawer
        paymentId={selectedPaymentId}
        onClose={() => setSelectedPaymentId(null)}
        onStateChanged={handleRefreshAll}
      />
    </div>
  );
}
