#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const includeRoots = [
  "README.md",
  "RELEASE.md",
  "CONTRIBUTING.md",
  ".github",
  "skills",
  "scripts",
];

const allowedExt = new Set([
  ".md",
  ".yml",
  ".yaml",
  ".json",
  ".js",
  ".sh",
  ".txt",
]);

const localPathPatterns = [
  { label: "macOS absolute path", re: /\/Users\/[A-Za-z0-9._-]+\//g },
  { label: "Linux absolute path", re: /\/home\/[A-Za-z0-9._-]+\//g },
  { label: "Windows absolute path", re: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/g },
];

function exists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function walk(absPath, out) {
  const st = fs.statSync(absPath);
  if (st.isDirectory()) {
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walk(path.join(absPath, ent.name), out);
    }
    return;
  }

  const ext = path.extname(absPath).toLowerCase();
  if (!allowedExt.has(ext) && path.basename(absPath) !== "CODEOWNERS") return;
  out.push(absPath);
}

function lineNumberForIndex(content, idx) {
  let lines = 1;
  for (let i = 0; i < idx; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  return lines;
}

const files = [];
for (const rel of includeRoots) {
  if (!exists(rel)) continue;
  walk(path.join(repoRoot, rel), files);
}

const violations = [];
for (const filePath of files) {
  const relPath = path.relative(repoRoot, filePath);
  const content = fs.readFileSync(filePath, "utf8");

  for (const pattern of localPathPatterns) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(content)) !== null) {
      violations.push({
        file: relPath,
        line: lineNumberForIndex(content, match.index),
        label: pattern.label,
        value: match[0],
      });
    }
  }
}

if (violations.length > 0) {
  console.error("[no-local-paths] found machine-specific absolute paths:");
  for (const v of violations) {
    console.error(`- ${v.file}:${v.line} (${v.label}) -> ${v.value}`);
  }
  process.exit(1);
}

console.log("[no-local-paths] ok: no machine-specific absolute paths found in checked files");
