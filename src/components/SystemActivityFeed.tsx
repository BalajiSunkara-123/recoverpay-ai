/**
 * RecoverPay System Activity Feed
 * 
 * Live chronological observability feed displaying recovery pipeline events:
 * AI diagnosis → Policy evaluation → Router dispatch → Verification → Audit append
 */

import React from 'react';
import { Activity, Clock, ShieldCheck, Zap, CheckCircle2, FileText, ExternalLink } from 'lucide-react';

export interface SystemActivityItem {
  id: string;
  timestamp: string;
  type: 'ai' | 'policy' | 'dispatch' | 'capture' | 'audit' | 'error';
  title: string;
  detail?: string;
  paymentId?: string;
  statusBadge?: string;
  statusColor?: string;
}

interface SystemActivityFeedProps {
  activities: SystemActivityItem[];
  onSelectPayment?: (paymentId: string) => void;
}

export const SystemActivityFeed: React.FC<SystemActivityFeedProps> = ({
  activities,
  onSelectPayment
}) => {
  const getIcon = (type: SystemActivityItem['type']) => {
    switch (type) {
      case 'ai':
        return <Activity className="w-3.5 h-3.5 text-indigo-400" />;
      case 'policy':
        return <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />;
      case 'dispatch':
        return <Zap className="w-3.5 h-3.5 text-amber-400" />;
      case 'capture':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'audit':
        return <FileText className="w-3.5 h-3.5 text-slate-400" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-lg flex flex-col h-full">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <h2 className="text-sm font-semibold text-slate-100">System Activity</h2>
        </div>
        <span className="text-[11px] text-slate-500 font-mono">
          Live Observability
        </span>
      </div>

      {/* Feed List */}
      <div className="p-3 space-y-2 overflow-y-auto max-h-[580px] flex-1">
        {activities.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No pipeline events recorded yet. Run a demo scenario or inspect a payment.
          </div>
        ) : (
          activities.map(act => (
            <div
              key={act.id}
              onClick={() => act.paymentId && onSelectPayment && onSelectPayment(act.paymentId)}
              className={`p-2.5 rounded border border-slate-800/80 bg-slate-900/40 hover:bg-slate-900/80 transition-colors text-xs flex flex-col gap-1 ${
                act.paymentId ? 'cursor-pointer group' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {getIcon(act.type)}
                  <span className="font-mono text-[11px] text-slate-400">
                    {act.timestamp}
                  </span>
                  <span className="font-medium text-slate-200 truncate">
                    {act.title}
                  </span>
                </div>
                {act.statusBadge && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded border font-semibold shrink-0 ${
                      act.statusColor || 'text-slate-400 bg-slate-800 border-slate-700'
                    }`}
                  >
                    {act.statusBadge}
                  </span>
                )}
              </div>

              {(act.detail || act.paymentId) && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 pl-5">
                  <span className="truncate">{act.detail}</span>
                  {act.paymentId && (
                    <span className="font-mono text-[10px] text-slate-500 group-hover:text-blue-400 shrink-0 flex items-center gap-0.5 ml-2">
                      <span>{act.paymentId}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2.5 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between font-mono bg-slate-900/30">
        <span>Zero-Trust Event Stream</span>
        <span>SHA-256 Ledger Backed</span>
      </div>
    </div>
  );
};
