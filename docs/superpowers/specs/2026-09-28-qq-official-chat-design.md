# QQ 官方群聊机器人第一版

用户已确认采用「QQ 官方接入＋独立聊天核心」。交付代码、离线测试、配置示例和部署说明；真实上线需要用户的官方 AppID/AppSecret、群聊权限、模型凭证和公网 HTTPS 地址。

## 范围与边界

- Node.js 20+、ES modules，沿用现有依赖，不调整已有微信等通道行为。
- 官方 webhook 收到 `GROUP_AT_MESSAGE_CREATE` 才触发；不通过昵称字符串猜测 @，忽略私聊、频道和其他事件。
- 验证回调地址（op 13）、Ed25519 原始请求体验签、AppID 校验，正常事件立即返回 `{"op":12}`，模型调用异步执行。
- QQ REST 层负责 access token 缓存与单次失效刷新，调用 `/v2/groups/{group_openid}/messages`，携带原消息 `msg_id`、`msg_seq:1`、`msg_type:0`。
- 标准化消息 `{ platform, botId, groupId, userId, messageId, text }` 进入独立核心。未来 OneBot 适配同一接口即可复用核心。
- 核心按平台＋机器人＋群＋用户隔离上下文；仅保存成功生成的问答；`/reset` 清除当前会话，`/help` 返回使用提示。
- 独立 OpenAI-compatible provider 支持 API Key、base URL、model、system prompt（环境变量或 UTF-8 文件）、请求超时。只接聊天接口，不执行本机命令或 agent 工具。
- 限制输入、上下文轮数、回复长度、会话数量、空闲 TTL、全局并发；同一会话处理期间返回忙碌提示，设置会话冷却时间。
- QQ 层包含可选群 openid 白名单、TTL 去重和队列容量限制；进程内缓存有界；不记录消息正文或密钥。
- 第一版单进程、内存会话和内存待处理任务。重启后上下文与去重记录清空；回调 ACK 后崩溃可能丢失回复。横向扩展、持久化队列、媒体消息、多群不同提示词不在第一版范围。

## 配置与启动

`npm run qq:agent` / `node cli.js qq agent`。QQ 配置独立放在 `src/platforms/qq/config.js`，聊天配置使用 `CHAT_*`，不复用会破坏 role 历史的旧单轮 provider。API Key/地址可回退到现有 `OPENAI_*` 配置。

默认只监听 127.0.0.1:3001，由 HTTPS 反向代理转发 `/webhook/qq`。`/healthz` 只返回存活状态。支持 QQ 正式与沙箱 API 地址；开放平台能力和实际测试名单以控制台为准。

## 验收

离线测试覆盖：官方文档签名向量、篡改请求拒绝、未签名事件拒绝、验证回调、ACK 早于模型完成、群 @过滤、白名单、重复事件、容量限制、token 缓存与刷新、被动回复字段、模型请求内容、会话隔离与重置、超时和并发控制、CLI 缺配置错误。补跑已有离线 CLI/微信配置测试。

官方参考：https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
