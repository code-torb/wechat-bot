# 个人微信协议与 OpenClaw 微信渠道可行性核查

核查日期：2026-09-28。范围：本仓库现有 Wechaty 接入，以及腾讯维护的 OpenClaw 微信渠道公开资料。本文只记录已公开的接口与待验证事项；没有执行测试号扫码、真实收发或 Ubuntu 部署。

## 结论

腾讯 GitHub 组织发布的 [`openclaw-weixin`](https://github.com/Tencent/openclaw-weixin/blob/main/README.zh_CN.md) 与 npm 包 [`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin) 是真实存在的微信渠道插件。OpenClaw [官方渠道文档](https://docs.openclaw.ai/zh-CN/channels/wechat)称其由腾讯微信团队维护，使用二维码登录、微信后端长轮询接收消息、经插件发送回复。它面向连接到一个 **ClawBot 对话身份** 的私信会话；该文档明确写明“能力元数据未声明支持群聊（仅声明支持私信）”。因此，现有证据只支持将它作为**测试号的私聊可行性实验**，不能认定它能替代本项目“普通个人微信群内 @ 机器人”的协议后端。

腾讯仓库的[后端 API 协议文档](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)给出了客户端当前使用的 HTTPS JSON 路径、二维码、消息长轮询与发送格式，但文档自己限定：这些是**当前插件客户端行为**，并非完整的服务端契约；类型里出现 `group_id` 不代表插件支持群聊，也没有证明未经 OpenClaw 插件的独立客户端获准或稳定可用。用此文档直接开发自有 Puppet 服务，仍须逐项实测并厘清接口使用条件。

## 已确认的接口与代码边界

| 能力 | 已公开的事实 | 边界 |
| --- | --- | --- |
| Linux 运行 | 腾讯 [README](https://github.com/Tencent/openclaw-weixin/blob/main/README.zh_CN.md)要求 Node.js >=22.13.0 和相应 OpenClaw 版本；登录命令在运行 Gateway 的机器上扫码，凭据保存在本地。 | 公开资料未证明本测试号能在 Ubuntu 上完成授权，也未证明重启后的具体会话有效期。 |
| 登录 | [协议文档 QR-code login](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md#qr-code-login)列出 `get_bot_qrcode`、`get_qrcode_status`、`confirmed` 后的 bot token 与 bot ID。 | 登录对象是 bot 身份；不能据此推断可读取扫码个人号既有的好友聊天或普通群消息。 |
| 接收 | [协议文档 getUpdates](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md#getupdates)描述 `/ilink/bot/getupdates` 长轮询及 `get_updates_buf` 游标。 | 未见普通微信群消息投递保证、群事件权限或回调接口。这里是客户端拉取，不是 webhook。 |
| 发送 | [协议文档 sendMessage](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md#sendmessage)描述 `/ilink/bot/sendmessage`、目标用户 ID、`client_id`、文本项和会话 `context_token`。 | 文档提示缺少 context token 时客户端仍尝试发送，但不保证服务端接受；未见普通群目标可发送的证明。 |
| 群聊 | OpenClaw [官方渠道文档](https://docs.openclaw.ai/zh-CN/channels/wechat)明确只声明私信；腾讯[协议文档 Message model](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md#message-model)虽有 `group_id` 字段，同时警告这不保证群功能。 | 不能把 `group_id` 的类型声明当成收群消息、真实 @、向群发送的能力。 |
| Wechaty 服务 | 本地安装包 `wechaty-puppet-service@1.19.9` 的 `PuppetServerOptions` 要求 `endpoint`、`puppet`、`token`，其 `start()` 将已存在的 Puppet 对象注册为 gRPC 服务；`wechaty-puppet` 类型含 `messagePayload`、`messageSendText` 与 scan/login/message 事件。 | `PuppetServer` 不是微信协议实现，不能独自取得账号授权或消息。见本仓库 `node_modules/wechaty-puppet-service/dist/esm/src/server/puppet-server.js`、`node_modules/wechaty-puppet/dist/esm/src/schemas/message.d.ts`。 |
| 本仓库现状 | [`src/platforms/wechat/puppetConfig.js`](../../src/platforms/wechat/puppetConfig.js)的 `service` 模式是 Puppet Service **客户端**；[`src/platforms/wechat/bot.js`](../../src/platforms/wechat/bot.js)通过 Wechaty 消费消息。 | 目前没有自研 Puppet 服务端或 iLink 适配器。AI 处理依赖 [`defaultMessage`](../../src/wechaty/sendMessage.js) 的 Wechaty 对象与群名、`BOT_NAME` 文本匹配。 |

## 阶段一验证门槛

1. 仅用专用测试号和测试会话，在目标 Ubuntu 环境运行**官方插件原样**，记录插件与 OpenClaw 固定版本。由用户在手机上扫描并确认；凭据留在机器本地。
2. 核对登录后的身份：是单独的 ClawBot 联系人，还是可访问原个人号聊天。用另一个测试号发一条唯一私聊文本，记录入站 ID、发送人 ID、接收时间；回复固定文本并记录发送结果。
3. 将同一身份加入普通测试群，实测三件事：收到群内文本、识别真实 @、向该群发送文本。**任一项失败即判定其不满足现有群机器人目标**，无需先写 Puppet 桥接层。
4. 重启 Gateway 和 Ubuntu，确认已授权状态能恢复；另测短暂断网后的游标与重复消息表现。`channels status` 显示 OK 不能代替真实双向收发。
5. 如考虑绕过 OpenClaw、直接调用 iLink API，应先获得可独立使用的明确接口条件，并在隔离原型中用测试号复现登录、收、发、恢复；当前公开客户端文档不足以承诺该路径可交付。

## 阶段二决策

若官方插件只通过私信验收，可选择把**产品目标改为 ClawBot 私聊**，再评估对接现有 AI 逻辑；OpenClaw 插件目前不是 Wechaty Puppet，不能直接填入 `WECHATY_PUPPET_SERVICE_TOKEN`。若普通群验收通过且接口使用条件明确，再实现 iLink 到 Puppet 的映射、会话与游标持久化、消息 ID 去重、发送结果查询及 Ubuntu 服务管理。若群验收失败，停止此路线的群机器人开发。
