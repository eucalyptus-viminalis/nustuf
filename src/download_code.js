import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const DOWNLOAD_CODE_HEADER = "X-LEAK-DOWNLOAD-CODE";

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

function assertHex(value, label) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error(`Invalid ${label} encoding`);
  }
}

function normalizeCode(value) {
  return String(value || "").trim();
}

export function parseDownloadCodeHash(encoded) {
  const raw = String(encoded || "").trim();
  const parts = raw.split("$");
  if (parts.length !== 6) throw new Error("Invalid download code hash format");
  if (parts[0] !== SCRYPT_PREFIX) throw new Error("Unsupported download code hash format");

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const digestHex = parts[5];

  if (!Number.isFinite(n) || n <= 0) throw new Error("Invalid download code hash parameter: N");
  if (!Number.isFinite(r) || r <= 0) throw new Error("Invalid download code hash parameter: r");
  if (!Number.isFinite(p) || p <= 0) throw new Error("Invalid download code hash parameter: p");
  assertHex(saltHex, "salt");
  assertHex(digestHex, "digest");

  return {
    n: Math.floor(n),
    r: Math.floor(r),
    p: Math.floor(p),
    salt: Buffer.from(saltHex, "hex"),
    digest: Buffer.from(digestHex, "hex"),
  };
}

export function isValidDownloadCodeHash(encoded) {
  try {
    parseDownloadCodeHash(encoded);
    return true;
  } catch {
    return false;
  }
}

export async function hashDownloadCode(downloadCode) {
  const normalized = normalizeCode(downloadCode);
  if (!normalized) throw new Error("Download code cannot be empty");

  const salt = randomBytes(16);
  const digest = await scrypt(normalized, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });

  return `${SCRYPT_PREFIX}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${Buffer.from(digest).toString("hex")}`;
}

export async function verifyDownloadCode(downloadCode, encodedHash) {
  const normalized = normalizeCode(downloadCode);
  if (!normalized) return false;

  const parsed = parseDownloadCodeHash(encodedHash);
  const actual = Buffer.from(
    await scrypt(normalized, parsed.salt, parsed.digest.length, {
      N: parsed.n,
      r: parsed.r,
      p: parsed.p,
      maxmem: 64 * 1024 * 1024,
    }),
  );

  if (actual.length !== parsed.digest.length) return false;
  return timingSafeEqual(actual, parsed.digest);
}
