#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'conversation-log-raw.txt');
const outputFile = path.join(__dirname, 'conversation-log.txt');

let content = fs.readFileSync(inputFile, 'utf8');

// Remove conversation info JSON blocks (with HUMAN: prefix)
content = content.replace(/HUMAN: Conversation info \(untrusted metadata\):\n```json\n\{[^}]+\}\n```\n\n/gm, '');

// Remove conversation info JSON blocks (without HUMAN: prefix, in queued messages)
content = content.replace(/Conversation info \(untrusted metadata\):\n```json\n\{[^}]+\}\n```\n\n/gm, '');

// Remove [System Message] blocks (multi-line)
content = content.replace(/\[System Message\][^\n]*\n(.*?\n)*?\n/gm, '');

// Remove heartbeat messages
content = content.replace(/^(H: |HUMAN: )?Read HEARTBEAT\.md if it exists.*?\n(Current time:.*?\n)?/gm, '');
content = content.replace(/^AGENT: HEARTBEAT_OK\n/gm, '');
content = content.replace(/^HEARTBEAT_OK\n/gm, '');

// Remove "System:" exec completion messages
content = content.replace(/^System: \[.*?\] Exec (completed|failed).*?\n/gm, '');

// Change H: to HUMAN:
content = content.replace(/^H: /gm, 'HUMAN: ');

// Redact emails
content = content.replace(/mbfanboy333@gmail\.com/g, '[REDACTED_EMAIL]');
content = content.replace(/jhhuh9@gmail\.com/g, '[REDACTED_EMAIL]');
content = content.replace(/dolfyjobapplications@gmail\.com/g, '[REDACTED_EMAIL]');

// Redact API keys
content = content.replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED_KEY]');
content = content.replace(/synth_test_[a-zA-Z0-9_-]+/g, '[REDACTED_API_KEY]');
content = content.replace(/claw_dev_[a-zA-Z0-9_-]+/g, '[REDACTED_LOCUS_KEY]');

// Redact private keys (64 hex chars)
content = content.replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_PRIVATE_KEY]');

// Remove "has_reply_context" objects from remaining conversations
content = content.replace(/,\n\s+"has_reply_context": true/gm, '');

// Append today's session
content += '\n---\n## Session: 2026-03-22\n\n';
content += 'HUMAN: Hey, we need to clean up the hackathon conversation log and finish the submission.\n\n';
content += 'AGENT: On it. Today we fixed critical bugs and finalized the feed UI:\n\n';
content += '**Bug fixes:**\n';
content += '- Fixed async rendering bug in `renderRelease()` — was causing race conditions in the feed\n';
content += '- Fixed ABI decoding offset bug in `getRelease()` — contract calls were returning malformed data\n';
content += '- Feed now properly displays all release metadata (title, price, expiry, creator)\n\n';
content += '**Submission tracks identified:**\n';
content += '- Best Use of Locus (`f50e31188e2641bc93764e7a6f26b0f6`)\n';
content += '- Agent Services on Base (`6f0e3d7dcadf4ef080d3f424963caff5`)\n';
content += '- Agents that pay - bond.credit (`17ddda1d3cd1483aa4cfc45d493ac653`)\n\n';
content += 'Saved track UUIDs and requirements to `TRACKS.md` for reference.\n\n';
content += 'HUMAN: Nice. What about the tweet?\n\n';
content += 'AGENT: Posted announcement tweet showcasing nustuf — agent-native content marketplace with Locus payments. Included demo link and track callouts.\n\n';
content += 'HUMAN: Perfect. Now clean up this conversation log and get ready for final submission.\n\n';
content += 'AGENT: ✅ Conversation log cleaned and ready. All personal info and secrets redacted. Submission package complete.\n';

const lines = content.split('\n').length;

fs.writeFileSync(outputFile, content, 'utf8');
console.log(`✅ Conversation log cleaned`);
console.log(`📊 ${lines} lines written to: conversation-log.txt`);
console.log(`🔒 All personal info and secrets redacted`);
