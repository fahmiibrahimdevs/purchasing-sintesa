import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

export type SearchableOption = {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Cari opsi…",
  className = "",
  disabled = false,
  ariaLabel,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0, above: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const allOptions = useMemo(() => [{ value: "", label: placeholder }, ...options], [options, placeholder]);
  const selected = allOptions.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return allOptions;
    return allOptions.filter((option) =>
      `${option.label} ${option.sublabel || ""} ${option.value}`.toLocaleLowerCase().includes(query),
    );
  }, [allOptions, search]);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const above = window.innerHeight - rect.bottom < 280 && rect.top > 280;
    setPosition({ top: above ? rect.top - 6 : rect.bottom + 6, left, width, above });
  }

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("keydown", onKeyDown);
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen]);

  function choose(option: SearchableOption) {
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    setSearch("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel || placeholder}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => {
          updatePosition();
          setIsOpen((open) => !open);
        }}
        className={`flex w-full items-center justify-between gap-2 text-left ${className}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected && value ? "text-slate-900" : "text-slate-400"}`}>
          {selected?.label || placeholder}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: position.above ? undefined : position.top,
            bottom: position.above ? window.innerHeight - position.top : undefined,
            left: position.left,
            width: position.width,
            zIndex: 99999,
          }}
          className="overflow-hidden rounded-xl border border-slate-200 bg-white font-sans shadow-xl"
        >
          <div className="relative border-b border-slate-100 bg-slate-50/70 p-2">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filteredOptions.length ? filteredOptions.map((option) => (
              <button
                key={option.value || "__empty"}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => choose(option)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${option.value === value ? "bg-blue-50 font-semibold text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.sublabel && <span className="mt-0.5 block truncate text-[10px] font-normal text-slate-500">{option.sublabel}</span>}
                </span>
                {option.value === value && <Check size={14} className="shrink-0 text-blue-600" />}
              </button>
            )) : <p className="px-3 py-6 text-center text-xs text-slate-500">Tidak ada opsi yang cocok.</p>}
          </div>
          {options.length > 8 && <div className="border-t border-slate-100 bg-slate-50/70 px-3 py-1.5 text-right text-[10px] text-slate-500">{filteredOptions.length} dari {allOptions.length} opsi</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
