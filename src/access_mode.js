export const ACCESS_MODE_VALUES = Object.freeze([
  "no-download-code-no-payment",
  "download-code-only-no-payment",
  "payment-only-no-download-code",
  "download-code-and-payment",
]);

export const DEFAULT_ACCESS_MODE = "payment-only-no-download-code";

const ACCESS_MODE_SET = new Set(ACCESS_MODE_VALUES);

export function normalizeAccessMode(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidAccessMode(value) {
  return ACCESS_MODE_SET.has(normalizeAccessMode(value));
}

export function resolveAccessMode(value, fallback = DEFAULT_ACCESS_MODE) {
  const normalized = normalizeAccessMode(value);
  if (ACCESS_MODE_SET.has(normalized)) return normalized;
  return fallback;
}

export function accessModeRequiresDownloadCode(mode) {
  const normalized = normalizeAccessMode(mode);
  return (
    normalized === "download-code-only-no-payment" ||
    normalized === "download-code-and-payment"
  );
}

export function accessModeRequiresPayment(mode) {
  const normalized = normalizeAccessMode(mode);
  return (
    normalized === "payment-only-no-download-code" ||
    normalized === "download-code-and-payment"
  );
}

export function accessModeSummary(mode) {
  const normalized = normalizeAccessMode(mode);
  if (normalized === "download-code-and-payment")
    return "Download code and payment required";
  if (normalized === "download-code-only-no-payment")
    return "Download code required; no payment";
  if (normalized === "payment-only-no-download-code")
    return "Payment required; no download code";
  return "No download code; no payment";
}
