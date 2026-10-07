import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// Wallets nustuf generates for the user. One plain key file per role, in the same format
// `--private-key-file` and `--buyer-private-key-file` accept (first line, 0x-prefixed hex).
// These are hot wallets: keep balances small.
export const WALLET_ROLES = ["buyer", "seller"];

function userHomeDir() {
  return process.env.HOME || os.homedir();
}

export function walletsDir() {
  return path.join(userHomeDir(), ".nustuf", "wallets");
}

export function isWalletRole(role) {
  return WALLET_ROLES.includes(role);
}

export function walletPath(role) {
  if (!isWalletRole(role)) {
    throw new Error(`Unknown wallet role "${role}". Use ${WALLET_ROLES.join(" or ")}.`);
  }
  return path.join(walletsDir(), `${role}.key`);
}

function normalizeKey(raw) {
  const first = String(raw).split(/\r?\n/, 1)[0].trim();
  return first.startsWith("0x") ? first : `0x${first}`;
}

// Returns the stored private key for the role, or null when no wallet has been created.
export function readWalletKey(role) {
  const file = walletPath(role);
  if (!fs.existsSync(file)) return null;
  const key = normalizeKey(fs.readFileSync(file, "utf8"));
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`Wallet file ${file} does not contain a valid private key.`);
  }
  return key;
}

export function getWalletAddress(role) {
  const key = readWalletKey(role);
  return key ? privateKeyToAccount(key).address : null;
}

// Creates a new wallet for the role and returns { address, file }. Never overwrites: the key file
// is opened with the "wx" flag, so an existing wallet (and any funds in it) is left alone.
export function createWallet(role) {
  const file = walletPath(role);
  fs.mkdirSync(walletsDir(), { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(walletsDir(), 0o700);
  } catch {
    // best effort only
  }

  const key = generatePrivateKey();
  try {
    fs.writeFileSync(file, `${key}\n`, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (err.code === "EEXIST") {
      throw new Error(`A ${role} wallet already exists (${getWalletAddress(role)}). Use \`nustuf wallet show --role ${role}\`.`);
    }
    throw err;
  }
  return { address: privateKeyToAccount(key).address, file };
}
