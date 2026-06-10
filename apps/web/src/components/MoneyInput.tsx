// 10-Jun · Reusable dollar-amount input with live US thousands-separator
// formatting. Drop-in replacement for any <input type="number"> that
// captures a dollar amount.
//
// Behaviour:
//   - User types digits → the input visually shows them with US commas
//     ("56000000000" → "56,000,000,000") on every keystroke.
//   - Pasting "$56,000,000,000" works — non-digits get stripped on the
//     way in.
//   - Cursor position is preserved across re-formatting so editing in
//     the middle of a number doesn't jump the caret to the end.
//   - Backspace / Delete behave normally.
//   - Decimals supported — one '.' allowed; two-digit cap on the
//     fractional side (matches NUMERIC(20, 2) on the backend).
//   - onChange emits the *raw* numeric string (no commas) so callers
//     can pass it straight to a Decimal-typed backend field. Empty
//     input emits null so optional fields can clear.
//
// API:
//   <MoneyInput
//     value={form.value_usd}            // string | number | null
//     onChange={(v) => setForm({ ...form, value_usd: v })}
//     placeholder="$ 1,000,000"
//     disabled={!editable}
//     className="…"                     // any extra Tailwind classes
//   />

import { useRef, type ChangeEvent, type KeyboardEvent, type ClipboardEvent } from "react";

interface MoneyInputProps {
  /** Raw value as stored in form state — a numeric string ("56000000000"),
   *  a number, or null/undefined when blank. Commas are NEVER stored
   *  here; they only appear in the rendered input. */
  value: string | number | null | undefined;
  /** Called with the raw value (no commas) on every edit. null when
   *  the user clears the field. */
  onChange: (next: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Optional inline style passthrough (Tailwind classes preferred). */
  style?: React.CSSProperties;
  /** HTML name for forms / accessibility. */
  name?: string;
  /** Optional aria-label / aria-describedby etc. */
  "aria-label"?: string;
}

/** Strip everything except digits and a single decimal point. Returns a
 *  canonical raw string that can be JSON-serialised straight to the
 *  backend's Decimal field. Empty / "." → "". */
export function rawMoney(input: string): string {
  // Remove every character except digits and the first dot.
  let sawDot = false;
  let cleaned = "";
  for (const ch of input) {
    if (ch >= "0" && ch <= "9") {
      cleaned += ch;
    } else if (ch === "." && !sawDot) {
      cleaned += ".";
      sawDot = true;
    }
  }
  // Cap fractional part to 2 digits.
  const dot = cleaned.indexOf(".");
  if (dot >= 0) {
    cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).slice(0, 2);
  }
  // Strip leading zeros except "0" / "0.xx".
  if (cleaned.length > 1 && cleaned[0] === "0" && cleaned[1] !== ".") {
    cleaned = cleaned.replace(/^0+/, "") || "0";
  }
  return cleaned;
}

/** Format a raw money string with US thousands-separator commas. Keeps
 *  trailing decimal point + fractional digits exactly as typed so the
 *  caret doesn't jump. */
export function formatMoney(raw: string): string {
  if (!raw) return "";
  const dot = raw.indexOf(".");
  const intPart = dot >= 0 ? raw.slice(0, dot) : raw;
  const fracPart = dot >= 0 ? raw.slice(dot) : "";
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return withCommas + fracPart;
}

export function MoneyInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  style,
  name,
  "aria-label": ariaLabel,
}: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "number"
        ? rawMoney(String(value))
        : rawMoney(String(value));
  const display = formatMoney(raw);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const inp = e.target;
    const beforeCaret = inp.value.slice(0, inp.selectionStart ?? inp.value.length);
    // Count digits + dot to the LEFT of the caret in the raw view.
    const rawBefore = rawMoney(beforeCaret);
    const newRaw = rawMoney(inp.value);
    const newDisplay = formatMoney(newRaw);

    onChange(newRaw === "" ? null : newRaw);

    // Restore caret position after React re-renders. We can't predict
    // commas perfectly without re-walking, so set caret AFTER the
    // (rawBefore.length)-th raw character in newDisplay.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      let seenRaw = 0;
      let caret = 0;
      for (; caret < newDisplay.length; caret++) {
        if (seenRaw === rawBefore.length) break;
        const ch = newDisplay[caret];
        if (ch !== ",") seenRaw++;
      }
      el.setSelectionRange(caret, caret);
    });
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    // Strip $ / commas / spaces on paste before letting React process.
    const text = e.clipboardData.getData("text");
    const cleaned = rawMoney(text);
    if (cleaned === text) return; // nothing to strip — let it through
    e.preventDefault();
    onChange(cleaned === "" ? null : cleaned);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Allow standard editing keys; reject characters outside [0-9.]
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      e.key.length > 1 // Backspace, ArrowLeft, etc.
    ) {
      return;
    }
    if (!/[0-9.]/.test(e.key)) {
      e.preventDefault();
    }
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      name={name}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      value={display}
      onChange={handleChange}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      className={className}
      style={style}
    />
  );
}

export default MoneyInput;
