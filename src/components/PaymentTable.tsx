/**
 * RecoverPay Payment Operations Table
 * 
 * Professional, high-density operations table:
 * Payment ID | Amount | Failure Reason | AI Decision | Policy Gate | Execution | Status | Updated
 */

import React from 'react';
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Shield
} from 'lucide-react';
import { PaymentListItem } from '../lib/api.ts';

interface PaymentTableProps {
  payments: PaymentListItem[];
  total: number;
  loading: boolean;
  filter: string;
  onFilterChange: (f: string) => void;
  search: string;
  onSearchChange: (s: string) => void;
  sort: string;
  onSortChange: (s: string) => void;
  offset: number;
  limit: number;
  onPageChange: (newOffset: number) => void;
  onSelectPayment: (paymentId: string) => void;
  selectedPaymentId: string | null;
  onRefresh: () => void;
}

export const PaymentTable: React.FC<PaymentTableProps> = ({
  payments,
  total,
  loading,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  sort,
  onSortChange,
  offset,
  limit,
  onPageChange,
  onSelectPayment,
  selectedPaymentId,
  onRefresh
}) => {
  const filterOptions = [
    { id: 'all', label: 'All Failures' },
    { id: 'recoverable', label: 'Recoverable' },
    { id: 'recovered', label: 'Recovered' },
    { id: 'blocked', label: 'Policy Blocked' },
    { id: 'escalated', label: 'Escalated' },
    { id: 'high_value', label: 'High Value (>₹50k)' },
    { id: 'opted_out', label: 'Customer Opt-Out' }
  ];

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'captured':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/60">
            <CheckCircle2 className="w-3 h-3" />
            <span>Captured</span>
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-rose-950/40 text-rose-400 border border-rose-800/60">
            <XCircle className="w-3 h-3" />
            <span>Failed</span>
          </span>
        );
      case 'escalated':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-950/40 text-amber-400 border border-amber-800/60">
            <AlertTriangle className="w-3 h-3" />
            <span>Escalated</span>
          </span>
        );
      default:
        return (
          <span className="text-[11px] font-medium text-slate-400 px-2 py-0.5 rounded bg-slate-800 border border-slate-700 capitalize">
            {status}
          </span>
        );
    }
  };

  const renderActionBadge = (action?: string) => {
    if (!action) return <span className="text-slate-600 text-xs">—</span>;
    switch (action) {
      case 'RETRY_PAYMENT':
        return (
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-blue-950/50 text-blue-300 border border-blue-800/60">
            Retry
          </span>
        );
      case 'SEND_PAYMENT_REMINDER':
        return (
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-sky-950/50 text-sky-300 border border-sky-800/60">
            Reminder
          </span>
        );
      case 'ESCALATE':
        return (
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300 border border-amber-800/60">
            Escalate
          </span>
        );
      case 'STOP':
        return (
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            Stop
          </span>
        );
      default:
        return <span className="text-[11px] text-slate-400">{action}</span>;
    }
  };

  const renderPolicyBadge = (policy?: string, action?: string, status?: string) => {
    if (policy === 'ALLOWED') {
      return (
        <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          Allowed
        </span>
      );
    }
    if (policy === 'BLOCKED') {
      return (
        <span className="text-[11px] font-medium text-rose-400 bg-rose-950/30 border border-rose-800/50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" />
          Blocked
        </span>
      );
    }
    // If escalated or fail closed
    if (
      policy === 'ESCALATED' ||
      policy?.includes('FAIL_CLOSED') ||
      action === 'ESCALATE' ||
      status === 'escalated'
    ) {
      return (
        <span
          className="text-[10px] font-semibold text-amber-400 bg-amber-950/40 border border-amber-800/60 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
          title="Safety Invariant: Fails closed to ESCALATE on low confidence or validation violation"
        >
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          ESCALATED — FAIL CLOSED
        </span>
      );
    }
    if (policy === 'SKIPPED') {
      return (
        <span className="text-[11px] font-medium text-slate-400 bg-slate-800/60 border border-slate-700/50 px-1.5 py-0.5 rounded">
          Skipped
        </span>
      );
    }
    if (status === 'captured') {
      return (
        <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/30 border border-emerald-800/50 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          Allowed
        </span>
      );
    }
    return (
      <span className="text-[10px] font-medium text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
        <Shield className="w-3 h-3 text-slate-500" />
        {policy || 'Pending Evaluation'}
      </span>
    );
  };

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-lg flex flex-col">
      {/* Header & Controls Toolbar */}
      <div className="p-3.5 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-100">Recovery Operations</h2>
          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
            {total} payments
          </span>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search ID, customer, reason..."
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              className="pl-8 pr-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48 sm:w-56"
            />
          </div>

          {/* Filter Dropdown / Select */}
          <select
            value={filter}
            onChange={e => onFilterChange(e.target.value)}
            className="text-xs bg-slate-900 border border-slate-700 text-slate-300 rounded px-2.5 py-1 focus:outline-none focus:border-blue-500"
          >
            {filterOptions.map(opt => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Sort Select */}
          <select
            value={sort}
            onChange={e => onSortChange(e.target.value)}
            className="text-xs bg-slate-900 border border-slate-700 text-slate-300 rounded px-2.5 py-1 focus:outline-none focus:border-blue-500"
          >
            <option value="recent">Most Recent</option>
            <option value="amount_desc">Highest Amount</option>
            <option value="amount_asc">Lowest Amount</option>
            <option value="attempts_desc">Most Attempts</option>
          </select>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            className="p-1.5 rounded bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-400 hover:text-slate-200 transition-colors"
            title="Refresh Table"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-[11px] bg-slate-900/40">
              <th className="py-2.5 px-3 font-medium">Payment ID</th>
              <th className="py-2.5 px-3 font-medium">Amount</th>
              <th className="py-2.5 px-3 font-medium">Failure Reason</th>
              <th className="py-2.5 px-3 font-medium">AI Decision</th>
              <th className="py-2.5 px-3 font-medium">Policy Gate</th>
              <th className="py-2.5 px-3 font-medium">Execution</th>
              <th className="py-2.5 px-3 font-medium">Status</th>
              <th className="py-2.5 px-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {loading && payments.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                    <span>Loading payment operations data...</span>
                  </div>
                </td>
              </tr>
            ) : payments.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  No payment records match the selected filter.
                </td>
              </tr>
            ) : (
              payments.map((item, idx) => {
                const p = (item as any).payment || item;
                const cust = (item as any).customer;
                const latestEvent = (item as any).latestEvent;
                const paymentId: string = p.id || (item as any).id || `pay_row_${idx}`;
                const isSelected = selectedPaymentId === paymentId;
                const customerDisplay = cust?.name || (item as any).customer_name || p.customer_id || 'Unknown';
                const amountPaise = p.amount ?? (item as any).amount ?? 0;
                const failureReason = p.failure_reason || (item as any).failure_reason || p.failure_category || 'Payment failure';
                const errorCode = p.failure_code || (item as any).error_code || 'ERR';
                const recoveryAttempts = p.recovery_attempts ?? (item as any).recovery_attempts ?? 0;
                const agentAction = (item as any).last_agent_action || latestEvent?.recommended_action;
                const agentConfidence = (item as any).last_agent_confidence ?? latestEvent?.confidence;
                const policyStatus = (item as any).last_policy_status || latestEvent?.policy_decision;
                const toolName = (item as any).last_tool_name || latestEvent?.tool_called;
                const paymentStatus = p.status || (item as any).status || 'failed';

                return (
                  <tr
                    key={paymentId}
                    onClick={() => onSelectPayment(paymentId)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-950/30 border-l-2 border-l-blue-500'
                        : 'hover:bg-slate-900/60'
                    }`}
                  >
                    {/* Payment ID & Customer */}
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      <div className="font-semibold text-slate-200">{paymentId}</div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[120px]">
                        {customerDisplay}
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="py-2.5 px-3 font-mono text-[12px] font-semibold text-slate-200">
                      ₹{(amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>

                    {/* Failure Category */}
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-300 text-[11px] truncate max-w-[160px]">
                        {failureReason}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {errorCode} · {recoveryAttempts} retries
                      </div>
                    </td>

                    {/* AI Decision */}
                    <td className="py-2.5 px-3">
                      {renderActionBadge(agentAction)}
                      {typeof agentConfidence === 'number' && agentConfidence > 0 && (
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                          {(agentConfidence * 100).toFixed(0)}% conf
                        </div>
                      )}
                    </td>

                    {/* Policy Result */}
                    <td className="py-2.5 px-3">
                      {renderPolicyBadge(policyStatus, agentAction, paymentStatus)}
                    </td>

                    {/* Execution Tool */}
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                      {toolName ? (
                        <span className="text-[11px] text-slate-300">
                          {toolName.replace('tool_', '')}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="py-2.5 px-3">
                      {renderStatusBadge(paymentStatus)}
                    </td>

                    {/* View Drawer Action */}
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onSelectPayment(paymentId);
                        }}
                        className="text-[11px] text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 font-medium"
                      >
                        <span>Inspect</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
        <div>
          Showing {Math.min(offset + 1, total)}–{Math.min(offset + limit, total)} of {total} records
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={offset === 0 || loading}
            className="p-1 rounded bg-slate-900 border border-slate-700 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
            title="Previous Page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-xs text-slate-300 px-1">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total || loading}
            className="p-1 rounded bg-slate-900 border border-slate-700 hover:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300"
            title="Next Page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
