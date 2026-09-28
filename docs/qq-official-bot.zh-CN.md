# QQ 官方群聊机器人

普通 QQ 号已成为默认入口；使用 NapCat 时请看 [普通 QQ 号部署指南](./qq-personal-bot.zh-CN.md)。本文对应保留的官方接入。

第一版支持群聊中 **@机器人＋文字**、可配置 AI 模型和系统提示词、多轮对话、`/reset`、`/help`、群白名单、会话冷却和并发限制。

```text
QQ 群 @事件 → HTTPS Webhook（验签、去重、立即 ACK）
                          ↓
                 独立聊天核心（会话、提示词）
                          ↓
                  OpenAI-compatible 模型
                          ↓
                 QQ 官方 API 被动回复原消息
```

## 1. 准备 QQ 官方机器人

1. 在 [QQ 开放平台](https://bot.q.qq.com/open) 创建机器人，获取 **AppID、AppSecret**。旧的 Bot Token 不用于本实现。
2. 确认该机器人已获得 QQ 群聊及群消息权限。开发阶段按控制台要求添加测试成员、测试群；上线范围和审核要求以控制台为准。
3. 将机器人添加到有权限的 QQ 群。显示名称在开放平台设置，程序按官方 `GROUP_AT_MESSAGE_CREATE` 事件识别 @，不需要配置昵称。
4. 准备一个能被 QQ 平台访问的公网 HTTPS 域名，代理到下面的本地服务。官方文档允许的回调端口为 80、443、8080、8443；建议使用标准 HTTPS 443。

## 2. 配置模型和提示词

需要 Node.js **20 或更高版本**。在项目目录运行：

```sh
npm install
# 仅首次创建；已有 .env 时保留其中内容，手动补充 QQ/CHAT 配置
test -f .env || cp .env.example .env
```

在 `.env` 中填写，例如使用 DeepSeek 的 OpenAI-compatible 接口：

```dotenv
QQ_APP_ID='你的AppID'
QQ_APP_SECRET='你的AppSecret'

CHAT_API_KEY='你的模型APIKey'
CHAT_BASE_URL='https://api.deepseek.com/v1'
CHAT_MODEL='deepseek-chat'
CHAT_SYSTEM_PROMPT='你是群里的小助手。默认用中文，语气友好，回答简短清楚。不知道的事情如实说明。使用纯文本回复。'
```

也可以使用其他支持 `/chat/completions` 的服务：

| 服务         | CHAT_BASE_URL                                       | CHAT_MODEL                                |
| ------------ | --------------------------------------------------- | ----------------------------------------- |
| OpenAI       | `https://api.openai.com/v1`                         | 填写账号可用的聊天模型 ID                 |
| 通义千问     | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 例如 `qwen-plus`，以服务商可用模型为准    |
| 本机 Ollama  | `http://127.0.0.1:11434/v1`                         | 填写已下载的模型名，API Key 可填 `ollama` |
| 其他兼容服务 | 服务商的完整 API 基址，通常以 `/v1` 结尾            | 服务商给出的模型 ID                       |

本实现发送 `model`、`messages` 和 `max_tokens`，模型须支持这些 Chat Completions 字段。仅提供 Responses API、原生 Claude 接口或特殊模型参数的服务需要另写 provider。配置项无需修改 QQ 接入代码。

`CHAT_API_KEY` 和 `CHAT_MODEL` 为空时，分别回退到已有 `OPENAI_API_KEY` 和 `OPENAI_MODEL`；`CHAT_BASE_URL` 为空时回退到 `OPENAI_PROXY_URL`。QQ 通道不使用 `SERVICE_TYPE`、`--serve`、`PI_*` 或微信的 `BOT_NAME`。

较长的提示词可以放在文件里，例如新建 `qq-prompt.txt`：

```text
你是一个叫“小助手”的群聊机器人。
用中文回答；简单问题尽量在三句话内答完。
结合当前用户在本群的对话理解追问。
使用纯文本，不要编造事实。
```

```dotenv
CHAT_SYSTEM_PROMPT_FILE='./qq-prompt.txt'
```

UTF-8 文件优先于 `CHAT_SYSTEM_PROMPT`，相对路径以启动目录为准。修改模型或提示词后重启服务。

## 3. 启动和配置 HTTPS 回调

```sh
npm run qq:official
# 等价命令：node cli.js qq official
# npm link 后也可以：wb qq official
```

默认监听 `127.0.0.1:3001`，回调路径为 `/webhook/qq`。本地健康检查：

```sh
curl http://127.0.0.1:3001/healthz
# {"status":"ok"}
```

例如使用 Caddy（请替换为自己的已解析域名）：

```caddyfile
bot.example.com {
    reverse_proxy /webhook/qq 127.0.0.1:3001
}
```

反向代理必须保留 `X-Bot-Appid`、`X-Signature-Timestamp`、`X-Signature-Ed25519`，原样转发请求体。不要重新序列化 JSON，否则验签失败。

在开放平台的回调配置中填写 `https://bot.example.com/webhook/qq`，并订阅 **GROUP_AT_MESSAGE_CREATE（群 @机器人消息）**。保存时平台发送 op 13 验证请求，程序会自动返回签名；正常事件必须通过 Ed25519 验签及五分钟时间窗校验。确保服务器系统时间准确。

未签名的地址验证只接受 1–256 位字母、数字、下划线或连字符组成的 `plain_token`，拒绝任意 JSON 作为验证 token，防止该接口被用来签署伪造事件。如果平台改变 token 格式，应核对官方协议后调整字符规则。

容器部署可设置 `QQ_WEBHOOK_HOST='0.0.0.0'`，并将容器端口映射给反向代理。当前代码使用 [官方统一 API 地址](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/api-call-guide.html) `https://api.bot.qq.com`。如控制台要求其他环境地址，通过 `QQ_API_BASE_URL` 指定；不要把测试群管理和历史的沙箱域名混为一谈。

## 4. 群内使用

```text
@小助手 推荐三本科幻小说
@小助手 更适合初次阅读的呢？
@小助手 /reset
@小助手 /help
```

会话按「平台＋机器人＋群＋用户」隔离：其他群、其他用户不会混入当前上下文。`/reset` 只清除你在当前群的会话。**回复发送到群里，其他群成员仍然能看到；会话隔离不等于私聊。** 没有 @的消息不会发给模型；第一版忽略私聊、频道、图片、语音、卡片及引用消息等非纯文字事件。

同一会话正在生成时，新问题或 `/reset` 会得到忙碌提示，稍后可重试。生成失败不会写入历史。模型生成成功后会保存会话；如果 QQ 随后拒绝发送，该回答仍可能保留在上下文，可用 `/reset` 清除。

## 5. 常用配置

| 配置                   | 默认值        | 含义                                                           |
| ---------------------- | ------------- | -------------------------------------------------------------- |
| `QQ_GROUP_ALLOWLIST`   | 空            | 允许所有已加入的群；填入逗号分隔的 **group_openid** 可限制范围 |
| `QQ_WEBHOOK_HOST`      | `127.0.0.1`   | 本地监听地址                                                   |
| `QQ_WEBHOOK_PORT`      | `3001`        | 本地 HTTP 端口                                                 |
| `QQ_WEBHOOK_PATH`      | `/webhook/qq` | 回调路径                                                       |
| `QQ_MAX_PENDING`       | `32`          | 同时处理的事件上限，超过返回 503 供平台重试                    |
| `CHAT_MAX_TURNS`       | `10`          | 保留最近十轮成功问答                                           |
| `CHAT_SESSION_TTL_MS`  | `1800000`     | 会话空闲三十分钟后过期，后续请求时清理                         |
| `CHAT_MAX_SESSIONS`    | `1000`        | 内存会话上限，淘汰闲置会话，不淘汰正在处理的会话               |
| `CHAT_COOLDOWN_MS`     | `2000`        | 同一会话的模型调用冷却时间；可设 0                             |
| `CHAT_MAX_CONCURRENT`  | `4`           | 全局模型并发上限，超出返回忙碌提示                             |
| `CHAT_MAX_INPUT_CHARS` | `4000`        | 单条输入长度上限                                               |
| `CHAT_MAX_REPLY_CHARS` | `1500`        | 单条回复长度上限；配置范围 50–2000                             |
| `CHAT_TIMEOUT_MS`      | `45000`       | 模型请求超时，最大 120000；不自动重试模型请求                  |
| `CHAT_MAX_TOKENS`      | `1000`        | 传给模型的 `max_tokens`                                        |

`group_openid` 是官方回调中的 `d.group_openid`，**不是数字 QQ 群号**；不同 AppID 的 openid 也不同。可以从开放平台调试回调信息中获取。本服务默认不记录正文、完整回调或密钥。

QQ 官方对被动回复有时间和次数限制：目前群消息为五分钟内最多五次。本程序每条收到的消息只发送一次回复，使用原 `d.id` 和 `msg_seq:1`。token 失效仅刷新重试一次；其他发送错误不盲目重发。QQ 的审核、URL 发送权限和平台频控仍可能拒绝模型回答。

## 6. 验证与排查

```sh
npm run test:qq
```

测试使用本机模拟 HTTP 服务，不调用真实 QQ 或收费模型，不需要账号凭证。覆盖签名、鉴权缓存、事件过滤、去重、过载、配置、CLI、会话隔离和多轮重置等行为。

真实环境验收：

1. `qq official --help` 可用；缺配置时明确列出缺项。
2. `/healthz` 返回 ok；开放平台回调地址验证通过。
3. 测试群中 @机器人能收到模型回复，普通聊天不回复。
4. 同一用户追问能接上前文，其他成员拥有独立会话；`/reset` 后重新开始。
5. 若配置了白名单，白名单外的群不回复。

| 现象           | 排查方向                                              |
| -------------- | ----------------------------------------------------- |
| 回调验证失败   | 公网 HTTPS、端口、代理路径、AppID/AppSecret 是否一致  |
| 回调返回 401   | AppID、密钥、代理是否修改正文/请求头、服务器时间      |
| 群里 @没有事件 | 官方群聊权限、事件订阅、测试名单、机器人是否已加入群  |
| 只有忙碌提示   | 冷却时间、同会话请求是否完成、全局并发设置            |
| 模型失败提示   | 模型 Key、基址、模型 ID、兼容参数、服务余额与请求超时 |
| 回复发送失败   | QQ 权限、内容/URL限制、五分钟回复时效、平台频控       |

当前第一版为单进程、内存状态：重启会清空会话和去重缓存；回调 ACK 后进程崩溃可能丢失待回复任务。正常 SIGINT/SIGTERM 会等待在途任务完成再退出。正式高可用部署需要持久化任务队列和共享会话存储，本版不要直接启动多个实例分担同一个回调。

## 7. 普通 QQ 号接入

现已实现 NapCat / OneBot 适配层（`src/platforms/onebot`），将群 @事件转换为：

```js
{
  platform: ('qq-onebot', botId, groupId, userId, messageId, text)
}
```

调用 `createChatCore({ complete, ...options }).handle(message)` 获得回复，再由 OneBot 发送。模型、提示词、上下文、冷却和命令无需重写；登录、事件转换和发送接口由 OneBot 适配层处理。官方 openid 和普通 QQ 数字账号不直接对应，历史会话和群白名单需要重新设置。

## 官方协议参考（2026-09-28 核对）

- [访问凭证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/access-token.html)
- [事件订阅、Webhook ACK 和回调地址验证](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)
- [Ed25519 请求验签](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html)
- [群 @机器人事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_at_message_create.html)
- [发送群消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)
