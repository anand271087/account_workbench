// Shared searchable-dropdown picker.
//
// Same UX pattern as the Currency / Spend Pool / Geography pickers on
// Pre-Sales: small trigger button shows the current selection; clicking
// opens a popover with a search box at the top + scrollable list below.
// Replaces native `<select>` for long option lists.
//
// Usage:
//   <SearchablePicker
//     value={form.industry}
//     options={INDUSTRY_OPTIONS}
//     placeholder="Select Industry"
//     onChange={(v) => setForm({ ...form, industry: v })}
//   />
//
// For multi-select use `multiSelect` + `value` as `string[]`.

import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface BaseProps {
  options: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  /** Optional: pin a small group at the top of the list (e.g. "Common"
   *  currencies). When set, the popover shows two sections. */
  pinned?: readonly string[];
  /** Width override for the trigger button — defaults to 100% of parent. */
  triggerWidthClass?: string;
  /** Tag put on the trigger as data-testid for E2E tests. */
  testId?: string;
}

interface SingleProps extends BaseProps {
  multiSelect?: false;
  value: string;
  onChange: (next: string) => void;
}

interface MultiProps extends BaseProps {
  multiSelect: true;
  value: string[];
  onChange: (next: string[]) => void;
}

export function SearchablePicker(props: SingleProps | MultiProps) {
  const { options, disabled, placeholder, pinned, triggerWidthClass, testId } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q)) : options),
    [q, options],
  );
  const showPinned = !q && pinned && pinned.length > 0;

  const isMulti = props.multiSelect === true;
  const selectedSet = useMemo(
    () => (isMulti ? new Set(props.value as string[]) : new Set([props.value as string])),
    [isMulti, props.value],
  );

  function pick(opt: string) {
    if (isMulti) {
      const cur = new Set(props.value as string[]);
      if (cur.has(opt)) cur.delete(opt);
      else cur.add(opt);
      props.onChange(Array.from(cur));
    } else {
      props.onChange(opt);
      setOpen(false);
      setQuery("");
    }
  }

  const triggerLabel = (() => {
    if (isMulti) {
      const arr = props.value as string[];
      if (arr.length === 0) return placeholder ?? "Select…";
      if (arr.length === 1) return arr[0];
      return `${arr.length} selected`;
    }
    return (props.value as string) || placeholder || "Select…";
  })();

  return (
    <div ref={wrapRef} className={cn("relative", triggerWidthClass ?? "w-full")}>
      <button
        type="button"
        data-testid={testId}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "w-full text-left text-[12px] rounded-md border bg-white px-2.5 py-1.5 inline-flex items-center justify-between gap-1",
          "hover:border-beroe-blue/40 focus:outline-none focus:border-beroe-blue",
          "disabled:bg-beroe-bg disabled:text-text-secondary disabled:cursor-not-allowed",
          "border-beroe-card-border",
        )}
      >
        <span
          className={cn(
            "truncate",
            !((props.value as string | string[])?.length) && "text-text-secondary",
          )}
        >
          {triggerLabel}
        </span>
        <span
          className={cn(
            "text-[9px] text-text-muted transition-transform shrink-0",
            open && "rotate-180",
          )}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-30 mt-1 left-0 w-full min-w-[260px] rounded-md border border-beroe-card-border bg-white shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-beroe-card-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="🔍 Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {showPinned && (
              <>
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-text-muted bg-beroe-bg">
                  Common
                </div>
                {pinned!.map((opt) => (
                  <PickerRow
                    key={`pinned-${opt}`}
                    label={opt}
                    active={selectedSet.has(opt)}
                    isMulti={isMulti}
                    onPick={() => pick(opt)}
                  />
                ))}
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-text-muted bg-beroe-bg">
                  All
                </div>
              </>
            )}
            {matches.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-text-muted text-center">
                No match for &quot;{query}&quot;.
              </div>
            ) : (
              matches.map((opt) => (
                <PickerRow
                  key={opt}
                  label={opt}
                  active={selectedSet.has(opt)}
                  isMulti={isMulti}
                  onPick={() => pick(opt)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerRow({
  label, active, isMulti, onPick,
}: {
  label: string;
  active: boolean;
  isMulti: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      role="option"
      aria-selected={active}
      className={cn(
        "w-full px-3 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-beroe-bg",
        active && "bg-beroe-blue/5",
      )}
    >
      {isMulti && (
        <span
          className={cn(
            "w-3.5 h-3.5 inline-flex items-center justify-center rounded border flex-shrink-0",
            active
              ? "bg-beroe-blue border-beroe-blue text-white"
              : "border-beroe-card-border bg-white",
          )}
          aria-hidden
        >
          {active && <span className="text-[9px]">✓</span>}
        </span>
      )}
      <span className="flex-1 truncate text-text-primary">{label}</span>
      {!isMulti && active && (
        <span className="text-beroe-blue text-[10px]">✓</span>
      )}
    </button>
  );
}
