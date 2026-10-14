#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const KIND_BY_EXT = {
  ".js": "js",
  ".cjs": "js",
  ".mjs": "js",
  ".html": "html",
  ".sol": "sol",
  ".sh": "sh",
  ".yml": "yml",
  ".yaml": "yml",
  ".toml": "yml",
};

const VENDORED = [/^contracts\/lib\//, /^assets\//];

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function jsComments(text, offset = 0, base = text) {
  const sf = ts.createSourceFile("f.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const starts = new Set();
  const add = (ranges) => {
    for (const r of ranges || []) starts.add(r.pos);
  };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return [...starts].sort((a, b) => a - b).map((pos) => ({ line: lineAt(base, offset + pos) }));
}

function cssComments(text, offset, base) {
  const found = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "/" && text[i + 1] === "*") {
      found.push({ line: lineAt(base, offset + i) });
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    }
  }
  return found;
}

function htmlComments(text) {
  const found = [];
  const blocks = [];
  for (const m of text.matchAll(/(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)<\/script>/g)) {
    const start = m.index + m[1].length;
    blocks.push([m.index, m.index + m[0].length]);
    found.push(...jsComments(m[2], start, text));
  }
  for (const m of text.matchAll(/(<style[^>]*>)([\s\S]*?)<\/style>/g)) {
    const start = m.index + m[1].length;
    blocks.push([m.index, m.index + m[0].length]);
    found.push(...cssComments(m[2], start, text));
  }
  for (const m of text.matchAll(/<!--/g)) {
    if (!blocks.some(([a, b]) => m.index >= a && m.index < b)) found.push({ line: lineAt(text, m.index) });
  }
  return found.sort((a, b) => a.line - b.line);
}

function solComments(text) {
  const found = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const body = text.slice(i, end === -1 ? text.length : end);
      if (!/^\/\/\s*SPDX-License-Identifier:/.test(body)) found.push({ line: lineAt(text, i) });
      i = end === -1 ? text.length : end;
    } else if (ch === "/" && text[i + 1] === "*") {
      found.push({ line: lineAt(text, i) });
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    }
  }
  return found;
}

function hashComments(text, { allow = () => false } = {}) {
  const found = [];
  let quote = null;
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (n === 0 && line.startsWith("#!")) continue;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === "\\" && quote === '"') i++;
        else if (ch === quote) quote = null;
      } else if (ch === "\\") {
        i++;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
        if (!allow(line.slice(i))) found.push({ line: n + 1 });
        break;
      }
    }
  }
  return found;
}

const SWIFTBAR_METADATA = /^#\s*<(xbar|swiftbar)\.[a-zA-Z]+>/;

export function findComments(text, kind) {
  if (kind === "js") return jsComments(text);
  if (kind === "html") return htmlComments(text);
  if (kind === "sol") return solComments(text);
  if (kind === "sh") return hashComments(text, { allow: (rest) => SWIFTBAR_METADATA.test(rest) });
  if (kind === "yml") return hashComments(text);
  throw new Error(`Unknown kind: ${kind}`);
}

function listFiles() {
  const res = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (res.status !== 0) throw new Error(`git ls-files failed: ${res.stderr}`);
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .filter((f) => !VENDORED.some((re) => re.test(f)))
    .filter((f) => KIND_BY_EXT[path.extname(f).toLowerCase()])
    .filter((f) => fs.existsSync(path.join(repoRoot, f)));
}

function main() {
  const violations = [];
  for (const file of listFiles()) {
    const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
    for (const c of findComments(text, KIND_BY_EXT[path.extname(file).toLowerCase()])) {
      violations.push(`${file}:${c.line}`);
    }
  }
  if (violations.length > 0) {
    console.error("[no-comments] comments found (see AGENTS.md):");
    for (const v of violations) console.error(`- ${v}`);
    process.exit(1);
  }
  console.log("[no-comments] ok: no comments in code files");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
