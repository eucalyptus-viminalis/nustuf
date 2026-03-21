#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function extractSkillVersion(skillMd) {
  const frontmatter = skillMd.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return null;
  const versionLine = frontmatter[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("version:"));
  if (!versionLine) return null;
  return versionLine.slice("version:".length).trim();
}

function isSupportedVersion(v) {
  return /^\d{4}\.\d{1,2}\.\d+(?:-beta\.\d+)?$/.test(v);
}

const pkgPath = path.join(repoRoot, "package.json");
const pkgVersion = String(readJson(pkgPath).version || "").trim();

if (!pkgVersion) {
  console.error("[version-sync] package.json is missing version");
  process.exit(1);
}

if (!isSupportedVersion(pkgVersion)) {
  console.error(`[version-sync] invalid version format: ${pkgVersion}`);
  console.error("[version-sync] expected YYYY.M.P or YYYY.M.P-beta.N");
  process.exit(1);
}

const skillsDir = path.join(repoRoot, "skills");
if (!fs.existsSync(skillsDir)) {
  console.error(`[version-sync] skills directory not found: ${skillsDir}`);
  process.exit(1);
}

const skillDirs = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((ent) => ent.isDirectory())
  .map((ent) => ent.name);

const skillFiles = skillDirs
  .map((dir) => path.join(skillsDir, dir, "SKILL.md"))
  .filter((p) => fs.existsSync(p));

if (skillFiles.length === 0) {
  console.error("[version-sync] no skill files found under skills/*/SKILL.md");
  process.exit(1);
}

const mismatches = [];
for (const skillFile of skillFiles) {
  const rel = path.relative(repoRoot, skillFile);
  const skillVersion = String(extractSkillVersion(readText(skillFile)) || "").trim();

  if (!skillVersion) {
    mismatches.push(`${rel}: missing frontmatter version`);
    continue;
  }

  if (!isSupportedVersion(skillVersion)) {
    mismatches.push(`${rel}: invalid version format '${skillVersion}'`);
    continue;
  }

  if (skillVersion !== pkgVersion) {
    mismatches.push(`${rel}: ${skillVersion} (expected ${pkgVersion})`);
  }
}

if (mismatches.length > 0) {
  console.error(`[version-sync] mismatch against package.json=${pkgVersion}`);
  for (const msg of mismatches) {
    console.error(`- ${msg}`);
  }
  process.exit(1);
}

console.log(`[version-sync] ok: ${pkgVersion} (${skillFiles.length} skill files)`);
