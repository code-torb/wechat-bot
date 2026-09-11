# WeChat login diagnostics

For a scanned and confirmed QR code followed by `AssertionError: 1 == 0`, enable diagnostics for one run from the project directory:

```bash
git pull --ff-only origin main
WECHAT_LOGIN_DEBUG=true npm run start -- --serve deepseek-free
```

Alternatively set `WECHAT_LOGIN_DEBUG='true'` in `.env` and use your normal startup command. No edits to `node_modules` or new dependencies are needed.

After confirming login on the phone, look for `[wechat-login-debug]`:

- `stage`: `webwxinit` for an initialization response, otherwise `login`.
- `httpStatus`: HTTP response status, or `null` if unavailable.
- `ret` / `errMsg`: WeChat's response code and error text, when available.
- `hasSkey`, `hasSid`, `hasUin`, `hasPassTicket`: credential presence only.

The diagnostic excludes request URLs, cookies and response payloads. Known credential strings and URLs echoed in error text are redacted. Check any logs before sharing; the bot's existing QR-code output contains a login link.

`Ret=1` alone does not establish an account ban or an IP restriction. This instrumentation gathers evidence and does not change the login protocol. It uses the event hook in `wechaty-puppet-wechat4u@1.14.14`, tested with `wechat4u@0.7.14`. Recheck the hook if upgrading these dependencies.

After troubleshooting, omit the environment variable (or set it to `false` in `.env`). To run the offline diagnostic tests:

```bash
npm run test:wechat-login
```
