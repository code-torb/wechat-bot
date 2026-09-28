# 普通 QQ 号聊天机器人调整方案

用户已授权将第一版从官方机器人调整为私人普通 QQ 号，并选择 Linux / Docker 部署。沿用已经确认的「平台适配层＋独立聊天核心」结构。

## 接入与行为

- 普通 QQ 号登录 NapCat，NapCat 提供 OneBot v11 正向 WebSocket 服务；程序主动连接同机 / Docker 内网的该服务。不依赖官方 AppID、群聊开放权限或公网回调。
- 使用已有 `ws` 依赖，Authorization Bearer token 鉴权，`get_login_info` 确认账号，按 `echo` 关联 API 响应；断线自动重连，探活及请求超时，失败发送不自动重试。
- 只处理 `post_type:message`、`message_type:group`、真实 `at` 消息段指向当前登录 QQ 的事件。普通文本中的 @昵称、@全体成员、他人的 @、私聊、自发消息、匿名/通知和非文本内容不触发。NapCat 上报格式必须是 `array`。
- 将消息转换成 `{platform:'qq-onebot',botId,groupId,userId,messageId,text}`，调用已有聊天核心。按群＋用户隔离、多轮、提示词、模型、限频和 /reset /help 复用。
- 回复采用 OneBot `send_group_msg`，使用结构化 `reply` 与 `text` 消息段，模型输出不解析 CQ 码。
- 必填群号白名单（数字 QQ 群号）和 OneBot token；有界去重与待处理任务；校验登录身份，重连换号时旧连接产生的回答不能发送到新账号。
- 普通 QQ 成为 `npm run qq:agent` / `qq agent` 默认模式；`qq official` / `qq:official` 保留上一版入口。CHAT 配置抽到 src/chat/config.js，普通 QQ 不依赖任何官方 QQ 凭证。

## Linux / Docker

新增专用 Dockerfile 与 compose 文件。NapCat 登录数据及配置挂载独立 volumes；WebUI 仅发布到宿主机 127.0.0.1:6099，使用 SSH 隧道访问。OneBot 端口仅在 compose 网络中开放。用户在 NapCat WebUI 扫码登录并配置 WS server，应用用相同 token 连接。

单进程内存会话/去重；断线期间消息可能丢失；已生成但未送达回复可能留在上下文。普通 QQ 接入依赖第三方客户端兼容性，适合专用小号，存在掉线和账号风控风险。当前任务不下载运行 NapCat、不登录用户账号、不发送真实群消息。

## 验证

模拟 WS 服务验证鉴权、登录识别、echo 匹配、超时、失败返回、断线重连、探活、关闭清理。纯函数及集成测试验证 @识别、白名单、重复事件、自发消息过滤、CQ 注入防护、换号/重连期间旧回复保护、多轮与重置。回归现有官方 QQ 和微信离线测试。Docker 配置尽可能静态验证，不宣称未运行的镜像构建已通过。
