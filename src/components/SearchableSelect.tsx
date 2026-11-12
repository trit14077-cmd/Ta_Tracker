import React, { useState, useRef, useEffect, useMemo } from 'react';
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
}

/**
 * Searchable Select component enforcing strict selection from allowed options only (no free text).
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
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border border-slate-200 rounded-md shadow-lg overflow-hidden">
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

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500 text-center">
                Không có kết quả khớp trong danh sách.
              </div>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt === value;
                return (
                  <button
                    key={opt}
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
        </div>
      )}
    </div>
  );
};
