import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, PlusCircle } from 'lucide-react';

interface SearchableSelectProps {
  value: string;
  options: string[];
  onChange: (newValue: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
  compact?: boolean;
  onProposeNewValue?: () => void;
  /** Optional heading per option; options must already be ordered by group. */
  groupOf?: (option: string) => string;
}

/**
 * Searchable Select component enforcing strict selection from allowed options only (no free text).
 * Danh sách mở ra được vẽ ở <body> (portal) và đặt theo vị trí ô: khung cha có overflow-hidden không che mất phần dưới;
 * hết chỗ phía dưới thì mở lên trên.
 */
export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Chọn giá trị...',
  disabled = false,
  error = false,
  compact = false,
  onProposeNewValue,
  groupOf,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; listMax: number } | null>(null);

  // vị trí danh sách: dưới ô nếu đủ chỗ, không thì trên ô; cập nhật khi cuộn / đổi cỡ cửa sổ
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const extra = 45 + (onProposeNewValue ? 40 : 0); // ô tìm + nút đề xuất
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const width = Math.max(r.width, 220);
      const left = Math.min(r.left, Math.max(8, window.innerWidth - width - 8));
      if (below >= 224 + extra || below >= above) setPos({ left, width, top: r.bottom + 4, listMax: Math.max(96, Math.min(224, below - extra)) });
      else setPos({ left, width, bottom: window.innerHeight - r.top + 4, listMax: Math.max(96, Math.min(224, above - extra)) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onProposeNewValue]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
  }, [open]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t) && !panelRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutside);
    }
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        className={`flex items-center justify-between w-full rounded-md border bg-white text-left transition-colors ${
          compact ? 'px-2 py-1 text-xs min-h-[30px]' : 'px-3 py-2 text-sm min-h-[38px]'
        } ${
          disabled
            ? 'bg-slate-100 text-slate-500 cursor-not-allowed border-slate-200'
            : error
            ? 'border-red-500 focus:ring-2 focus:ring-red-200 cursor-pointer'
            : open
            ? 'border-blue-600 ring-2 ring-blue-100 cursor-pointer'
            : 'border-slate-300 hover:border-slate-400 cursor-pointer'
        }`}
      >
        <span className={`truncate ${value ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              title="Xóa lựa chọn"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </div>

      {open && !disabled && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
          className="z-[1000] bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Gõ để tìm trong danh sách..."
              className="w-full bg-transparent text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
            />
          </div>

          <div className="overflow-y-auto divide-y divide-slate-50" style={{ maxHeight: pos.listMax }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500 text-center">
                Không có kết quả khớp trong danh sách.
              </div>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt === value;
                const group = groupOf ? groupOf(opt) : '';
                const showHeading = Boolean(groupOf) && (idx === 0 || groupOf!(filtered[idx - 1]) !== group);
                return (
                  <React.Fragment key={opt}>
                  {showHeading && (
                    <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 bg-slate-100 sticky top-0">
                      {group}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="truncate">{opt}</span>
                    {isSelected && <span className="text-[11px] text-blue-600 ml-2 shrink-0">Đã chọn</span>}
                  </button>
                  </React.Fragment>
                );
              })
            )}
          </div>

          {onProposeNewValue && (
            <div className="border-t border-slate-100 bg-slate-50 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onProposeNewValue();
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded transition-colors"
              >
                <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Đề xuất thêm giá trị mới...</span>
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};
