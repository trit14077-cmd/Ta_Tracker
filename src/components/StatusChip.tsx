import React from 'react';
import { CheckCircle2, XCircle, Clock, AlertTriangle, UserCheck, UserMinus } from 'lucide-react';

interface StatusChipProps {
  value: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({ value }) => {
  const v = (value || '').trim();
  if (!v) return <span className="text-slate-400 text-xs">—</span>;

  const lower = v.toLowerCase();

  if (lower === 'passed' || lower === 'accepted' || lower === 'sent' || lower === 'đầy đủ' || lower.startsWith('đạt')) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 whitespace-nowrap">
        <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
        <span>{v}</span>
      </span>
    );
  }

  if (lower === 'joined' || lower === 'working') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200 whitespace-nowrap">
        <UserCheck className="w-3 h-3 text-blue-600 shrink-0" />
        <span>{v}</span>
      </span>
    );
  }

  if (lower === 'failed' || lower === 'declined' || lower === 'withdrawn' || lower === 'terminated' || lower === 'không đạt') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-800 border border-red-200 whitespace-nowrap">
        <XCircle className="w-3 h-3 text-red-600 shrink-0" />
        <span>{v}</span>
      </span>
    );
  }

  if (lower === 'resigned' || lower === 'no show' || lower === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200 whitespace-nowrap">
        <UserMinus className="w-3 h-3 text-rose-600 shrink-0" />
        <span>{v}</span>
      </span>
    );
  }

  if (lower === 'pending' || lower === 'probation' || lower === 'pending ob' || lower === 'rescheduled' || lower === 'postponed' || lower.includes('chờ') || lower.includes('thiếu')) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
        <Clock className="w-3 h-3 text-amber-600 shrink-0" />
        <span>{v}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
      <AlertTriangle className="w-3 h-3 text-slate-500 shrink-0" />
      <span>{v}</span>
    </span>
  );
};
