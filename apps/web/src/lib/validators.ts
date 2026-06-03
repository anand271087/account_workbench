/**
 * Shared input validators — used by every contact / user / stakeholder form
 * so the UX is consistent (and the rules don't drift across surfaces).
 *
 * Conventions:
 *   - `isValid<X>` returns boolean.
 *   - `<X>Error(value)` returns a human-readable error string or null.
 *   - `clean<X>Input(raw)` strips characters that cannot appear in a valid
 *     value, so onChange handlers can prevent the user from even typing
 *     them.
 *
 * The server enforces the same rules (Pydantic EmailStr etc.) — these are
 * the UX layer so errors surface instantly rather than after a round-trip.
 */

// Email — pragmatic regex matching RFC 5322 enough for UI gating.
// Anchored, requires local + "@" + domain + "." + TLD.
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.length > 254) return false; // RFC limit
  return EMAIL_RX.test(v);
}

export function emailError(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null; // empty = optional, not an error
  if (!v.includes("@")) return "Email must contain @";
  if (v.length > 254) return "Email is too long";
  if (!EMAIL_RX.test(v)) return "Enter a valid email (e.g. name@company.com)";
  return null;
}

// Phone — accept digits + standard separators. Strip everything else as
// the user types so the field can never hold garbage.
const PHONE_ALLOWED_RX = /[^\d+\-() ]/g;
const PHONE_DIGIT_RX = /\d/g;

/** Strip characters that can't appear in a phone number. Use inside
 *  onChange so the input rejects invalid keystrokes silently. */
export function cleanPhoneInput(raw: string): string {
  return raw.replace(PHONE_ALLOWED_RX, "");
}

export function isValidPhone(value: string): boolean {
  const cleaned = cleanPhoneInput(value);
  const digits = cleaned.match(PHONE_DIGIT_RX) ?? [];
  // 7 digits = minimum local number; 15 = ITU E.164 cap.
  return digits.length >= 7 && digits.length <= 15;
}

export function phoneError(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null; // empty = optional
  const cleaned = cleanPhoneInput(v);
  if (cleaned !== v) return "Phone can only contain digits + - ( ) and spaces";
  const digits = cleaned.match(PHONE_DIGIT_RX) ?? [];
  if (digits.length < 7) return "Phone must have at least 7 digits";
  if (digits.length > 15) return "Phone is too long (max 15 digits)";
  return null;
}

// Name — minimum length used by Contacts (matches backend constraint).
export function nameError(
  value: string | null | undefined,
  min = 3,
  max = 100,
): string | null {
  const v = (value ?? "").trim();
  if (!v) return "Name is required";
  if (v.length < min) return `Name must be at least ${min} characters`;
  if (v.length > max) return `Name is too long (max ${max} characters)`;
  return null;
}
