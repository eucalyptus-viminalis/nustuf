import { test } from "node:test";
import assert from "node:assert/strict";

import { findComments } from "../scripts/check_no_comments.js";

const lines = (text, kind) => findComments(text, kind).map((c) => c.line);

test("js: line, block and trailing comments are found", () => {
  const src = ['const a = 1; // trailing', "// own line", "/* block */", "/**", " * doc", " */", "const b = 2;"].join("\n");
  assert.deepEqual(lines(src, "js"), [1, 2, 3, 4]);
});

test("js: comment markers inside strings, templates and regexes are not comments", () => {
  const src = [
    'const u = "https://example.com/x";',
    "const t = `/* not */ ${u} // nope`;",
    "const r = /\\/\\/+/g;",
    "const h = '<!-- x -->';",
  ].join("\n");
  assert.deepEqual(lines(src, "js"), []);
});

test("js: a shebang is allowed", () => {
  assert.deepEqual(lines("#!/usr/bin/env node\nconst a = 1;\n", "js"), []);
});

test("html: html comments and comments in inline scripts and styles are found", () => {
  const src = [
    "<style>a { color: red; } /* css */</style>",
    "<!-- note -->",
    "<script>",
    'const u = "http://x";',
    "// js",
    "</script>",
  ].join("\n");
  assert.deepEqual(lines(src, "html"), [1, 2, 5]);
});

test("sol: SPDX is allowed, NatSpec and line comments are found, URLs in strings are not", () => {
  const src = [
    "// SPDX-License-Identifier: MIT",
    "/// @notice x",
    'string constant U = "https://a.b/c";',
    "uint256 p = 5; // trailing",
    "/** block */",
  ].join("\n");
  assert.deepEqual(lines(src, "sol"), [2, 4, 5]);
});

test("sh: shebang and swiftbar/xbar metadata are allowed; other comments are found", () => {
  const src = [
    "#!/bin/bash",
    "# <xbar.title>nustuf</xbar.title>",
    "# <swiftbar.hideAbout>true</swiftbar.hideAbout>",
    "# a note",
    'echo "# not a comment" ${#arr[@]} $#',
    "ls # trailing",
  ].join("\n");
  assert.deepEqual(lines(src, "sh"), [4, 6]);
});

test("yml: comments are found, # inside quotes is not", () => {
  assert.deepEqual(lines(['# top', 'name: "a # b"', "on: push # why"].join("\n"), "yml"), [1, 3]);
});
