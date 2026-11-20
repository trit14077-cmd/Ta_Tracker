// Nút lịch cạnh ô ngày DD/MM/YYYY: vẫn gõ tay được như hệ cũ, bấm nút thì chọn ngày trên lịch của trình duyệt.
import React, { useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatIsoDateToDisplay, parseDisplayDateToIso } from '../../../shared/validation.ts';

export const DatePickButton: React.FC<{ value: string; onPick: (display: string) => void; disabled?: boolean }> = ({ value, onPick, disabled }) => {
  const ref = useRef<HTMLInputElement>(null);
  const iso = parseDisplayDateToIso(value).iso;
  if (disabled) return null;
  return (
    <>
      <button
        type="button"
        title="Chọn ngày trên lịch"
        aria-label="Chọn ngày trên lịch"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
            el.click();
          }
        }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        onChange={(e) => e.target.value && onPick(formatIsoDateToDisplay(e.target.value))}
        className="absolute right-0 bottom-0 w-px h-px opacity-0 pointer-events-none"
      />
    </>
  );
};
