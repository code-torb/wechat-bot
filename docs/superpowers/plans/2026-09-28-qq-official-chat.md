# QQ Official Chat Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the tasks. User has authorized implementation; no further design approval is required.

**Goal:** Implement configurable, multi-turn QQ official group @ chat with a reusable platform-independent core.

**Architecture:** QQ webhook validates and normalizes events, acknowledges promptly and asynchronously calls the core. The core owns session state and calls an injected OpenAI-compatible provider. QQ REST transport sends passive replies.

**Tech Stack:** Node.js 20+, ESM, node:http, node:crypto, existing OpenAI SDK, node:test.

## Global Constraints

- Preserve all pre-existing uncommitted changes.
- Node.js 20+; no new dependencies or lockfile changes.
- Text-only official group @ events; memory state, single process.
- Never log prompts, API keys, tokens, or raw remote error bodies.
- No live messages or deployment without credentials and user deployment setup.

### Task 1: Independent chat core and provider

Files: `src/chat/core.js`, `src/chat/provider.js`, corresponding `*.test.js`.

Consumes normalized messages `{ platform, botId, groupId, userId, messageId, text }`; produces `createChatCore(options).handle(message): Promise<string|null>` and `createChatProvider(options)(messages): Promise<string>`.

- [x] Write node:test cases for isolated multi-turn state, /reset, /help, failed completion not entering history, TTL/size eviction, same-session busy response, global capacity, cooldown, length limits. Inject completion and clock functions.
- [x] Run `node --test src/chat/*.test.js` and capture missing-feature failures.
- [x] Implement bounded session maps with no eviction of active sessions; use complete role messages beginning with a system prompt; commit user/assistant turns only after successful completion; release active counters in finally.
- [x] Test provider against a local fake HTTP endpoint: inspect model, roles, max_tokens, Authorization, no automatic retries, timeout and invalid/empty response handling.
- [x] Run focused tests, self-review and report.

### Task 2: Official QQ protocol, webhook and runtime

Files: `src/platforms/qq/{signature,api,webhook,config,agent}.js`, matching tests.

Consumes Task 1 interfaces. Produces `startQQAgent()` and injectable `createQQWebhook({appId,appSecret,handleMessage,sendReply,groupAllowlist,...})` HTTP request handler.

- [x] Read official authentication/signature/group message documentation and store source links in user guide.
- [x] Write signature known-vector, token refresh, malformed callback, group normalization, deduplication, overload and asynchronous ACK tests; run them before implementation.
- [x] Implement Ed25519 seed derivation, signature verification over timestamp + exact body, and unsigned op 13 verification challenge response.
- [x] Implement bounded HTTP parsing; reject invalid signatures and app ids; normalize only group @ messages; reserve IDs before ACK and asynchronous dispatch; enforce pending capacity; catch errors without exposing remote bodies.
- [x] Implement cached QQ token API client; one 401 refresh; no blind send retries; passive text message with msg_id and msg_seq.
- [x] Implement strict config parsing, prompt file loading, startup validation and graceful SIGTERM/SIGINT shutdown.
- [x] Run `node --test src/platforms/qq/*.test.js`.

### Task 3: CLI, documentation and integration review

Files: `src/index.js`, `package.json`, `.env.example`, `README.md`, `README.zh-CN.md`, `docs/qq-official-bot.zh-CN.md`, CLI tests.

- [x] Add `qq agent` command via lazy import and `qq:agent` / `test:qq` scripts. Do not route QQ into the existing single-turn getServe interface.
- [x] Test CLI help and actionable missing configuration errors without launching WeChat or prompting.
- [x] Document official registration, event subscription, HTTPS proxy, sandbox testing, env settings, prompt file, session limits, migration boundaries and live acceptance checklist.
- [x] Run QQ tests plus existing offline CLI/config/WeChat tests; inspect diff for preservation of existing work.
- [x] Independent review of final scoped diff, resolve actionable findings and record remaining live verification requirement.

## Execution record

- Implemented on `codex/qq-official-chat`; pre-existing WeChat changes preserved. No new dependencies, live service calls, commits, push or deployment.
- `npm run test:qq`: 42 passed, 0 failed (loopback HTTP fixtures only).
- Existing offline CLI/config/WeChat tests: 10 passed, 0 failed.
- Scoped Prettier check and `git diff --check`: passed.
- Independent review: PASS after fixing active-session capacity admission, shutdown/body-stream race, and unsigned challenge signing abuse. Focused regression tests demonstrate each fix; Unicode reply truncation also tested.
- Protocol verified against official documentation on 2026-09-28; known callback validation signature matches the official vector.
- Real QQ registration and group acceptance remain deployment steps requiring the user's AppID/AppSecret, enabled group permissions, model credentials and HTTPS endpoint.
