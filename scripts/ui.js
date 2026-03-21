const ANSI_PREFIX = "\x1b[";
const ANSI_RESET = `${ANSI_PREFIX}0m`;

const COLOR_CODES = {
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
};

export function supportsColor(stream = process.stdout) {
  const noColorSet = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  if (noColorSet) return false;
  return Boolean(stream?.isTTY);
}

export function supportsHyperlinks(stream = process.stdout) {
  const noColorSet = Object.prototype.hasOwnProperty.call(process.env, "NO_COLOR");
  if (noColorSet) return false;
  if (!stream?.isTTY) return false;
  const term = String(process.env.TERM || "").toLowerCase();
  if (!term || term === "dumb") return false;
  return true;
}

function colorize(enabled, code, text) {
  const value = String(text ?? "");
  if (!enabled) return value;
  return `${ANSI_PREFIX}${code}m${value}${ANSI_RESET}`;
}

function normalizeRows(rows) {
  return rows
    .map((row) => {
      if (!row) return null;
      if (Array.isArray(row)) return { key: row[0], value: row[1] };
      return row;
    })
    .filter((row) => row && row.value !== undefined && row.value !== null && row.value !== "");
}

export function createUi(stream = process.stdout) {
  const enabled = supportsColor(stream);
  const hyperlinksEnabled = supportsHyperlinks(stream);

  const heading = (text) => colorize(enabled, `${COLOR_CODES.bold};${COLOR_CODES.cyan}`, text);
  const section = (text) => colorize(enabled, COLOR_CODES.bold, text);
  const muted = (text) => colorize(enabled, COLOR_CODES.dim, text);
  const key = (text) => colorize(enabled, COLOR_CODES.cyan, text);
  const value = (text) => String(text ?? "");

  const ok = (text) => colorize(enabled, COLOR_CODES.green, text);
  const warn = (text) => colorize(enabled, COLOR_CODES.yellow, text);
  const error = (text) => colorize(enabled, COLOR_CODES.red, text);
  const info = (text) => colorize(enabled, COLOR_CODES.blue, text);

  const statusLabel = (kind) => {
    const normalized = String(kind || "info").toLowerCase();
    if (normalized === "ok") return ok("[ok]");
    if (normalized === "warn") return warn("[warn]");
    if (normalized === "error") return error("[error]");
    return info("[info]");
  };

  const statusLine = (kind, text) => `${statusLabel(kind)} ${String(text ?? "")}`;

  const formatRows = (rows, options = {}) => {
    const { indent = "  ", keySuffix = ":" } = options;
    const normalized = normalizeRows(rows);
    const width = normalized.reduce((max, row) => Math.max(max, String(row.key).length), 0);
    return normalized.map((row) => {
      const label = `${String(row.key).padEnd(width)}${keySuffix}`;
      return `${indent}${key(label)} ${value(row.value)}`;
    });
  };

  const link = (url, label) => {
    const href = String(url ?? "").trim();
    const text = String(label ?? href);
    if (!href) return text;
    if (!hyperlinksEnabled) return text;
    if (!/^https?:\/\//i.test(href)) return text;
    return `\u001B]8;;${href}\u0007${text}\u001B]8;;\u0007`;
  };

  return {
    enabled,
    hyperlinksEnabled,
    heading,
    section,
    muted,
    key,
    value,
    ok,
    warn,
    error,
    info,
    statusLabel,
    statusLine,
    formatRows,
    link,
  };
}
