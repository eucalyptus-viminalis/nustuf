#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const releaseVersion = String(process.env.RELEASE_VERSION || "").trim();
if (!releaseVersion) {
  console.error("[changelog] missing RELEASE_VERSION env var");
  process.exit(1);
}

const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const changelog = fs.readFileSync(changelogPath, "utf8");
const sectionHeader = `## [${releaseVersion}]`;

if (!changelog.includes(sectionHeader)) {
  console.error(`[changelog] missing section: ${sectionHeader}`);
  process.exit(1);
}

console.log(`[changelog] ok: found ${sectionHeader}`);
