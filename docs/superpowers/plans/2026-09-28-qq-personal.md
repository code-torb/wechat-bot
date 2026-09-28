# Personal QQ Chat Implementation Plan

> Use superpowers:subagent-driven-development for independent config extraction and review, and test-driven development for the protocol integration. The user has explicitly authorized this switch; implement continuously.

**Goal:** Run the existing chatbot with a personal QQ account through NapCat on Linux/Docker.

**Architecture:** OneBot forward WS client handles authenticated connection and RPC; message adapter filters actual at segments and calls the unchanged independent chat core. Shared CHAT config serves official and personal transports.

**Tech Stack:** Node.js 20+, ESM, existing ws and OpenAI SDK, node:test, Docker Compose.

## Global Constraints

- Preserve all existing uncommitted work and official QQ functionality.
- No new runtime dependencies, no real account login, deployment or messages.
- Group @ text chat only, with numeric group allowlist and explicit OneBot access token.
- Do not log credentials, prompts, message bodies, tokens or raw remote errors.
- Bound caches/requests; no automatic retry of ambiguous sends; prevent account changes from redirecting in-flight replies.

### Task 1: Shared chat configuration

Files: src/chat/config.js, src/chat/config.test.js, src/platforms/qq/config.js.

Export `getChatConfig(env) -> {provider,core}` with the existing CHAT defaults, validation, OpenAI fallbacks and prompt file behavior. Official config continues aggregating its existing required QQ/CHAT errors and delegates shared parsing.

- [x] Write failing tests proving chat config works without QQ credentials and preserves existing CHAT behavior.
- [x] Extract CHAT parsing, retain official config output shape, run shared and official configuration tests.

### Task 2: OneBot WS and personal QQ adapter

Files: src/platforms/onebot/{client,messages,config,agent}.js and matching tests.

Export `createOneBotClient({url,accessToken,...}) -> {start,stop,call,on/off}`; emit `ready` with identity and connection generation, `event`, `disconnected`. Export normalization and safe group reply helpers. Runtime composes core, provider, client, dedup and shutdown.

- [x] Write failing local WS tests for authentication/login, echo, timeout, safe errors, disconnection/reconnect, heartbeat and stop.
- [x] Implement WS RPC client with max pending limit and payload limit, mandatory login handshake, generation isolation, bounded retry delay and safe fixed diagnostics.
- [x] Write failing event/filter tests and runtime tests; implement strict array-segment @ targeting, expected identity, allowlist, text-only and self-message filtering, bounded TTL dedup/pending, safe structured reply.
- [x] Verify model/session behavior through simulated WS runtime, including reset and delayed model completion across reconnect.

### Task 3: CLI and Linux/Docker deployment

Files: src/index.js, package.json, .env.example, README.md, README.zh-CN.md, Dockerfile.qq, compose.qq.yaml, docs/qq-personal-bot.zh-CN.md, docs/qq-official-bot.zh-CN.md, scoped CLI tests.

- [x] Test and implement `qq agent` for personal QQ and `qq official` for prior official version.
- [x] Document NapCat image/volumes/WebUI QR login/array events/token and private WS networking. Compose initially starts NapCat; chatbot begins after setup through an optional profile.
- [x] Validate tests, formatting and available Docker/static tooling; independent review and regression fixes.
- [x] Record real-login and deployment prerequisites, which are outside offline verification.

## Execution record

- Personal QQ is now the default `qq agent` / `qq:agent`; official mode is retained as `qq official` / `qq:official`.
- Added forward WS transport, authenticated identity, structured mentions and replies, bounded pending/dedup, reconnect/heartbeat, stale generation protection, shared CHAT config and Linux/Docker deployment files.
- `npm run test:qq`: 64 passed, 0 failed, using only local fake WS/HTTP. Existing offline CLI/config/WeChat regressions: 10 passed, 0 failed.
- Targeted tests include missing heartbeat pong and expected account mismatch.
- Scoped Prettier and `git diff --check`: passed. Compose YAML/service/profile/ports/volumes/prompt path static checks: passed.
- Independent code and deployment-guide review: PASS, no open actionable findings.
- Docker CLI is installed locally but Docker Compose is unavailable (`docker: unknown command: docker compose`). Image build, Compose deployment, NapCat login and real QQ group delivery were not run.
- All pre-existing workspace edits retained; no new runtime dependencies, credentials changes, real messages, deployment, commits or push.
