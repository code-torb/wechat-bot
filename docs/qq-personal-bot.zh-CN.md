# 普通 QQ 号群聊机器人（Linux / Docker）

本方案使用 **普通 QQ 号登录 NapCat → OneBot v11 正向 WebSocket → 独立聊天核心 → 群内回复**。不需要申请官方机器人、AppID 或公网 HTTPS 回调。

已支持：群内真实 @机器人时回复、自定义模型与提示词、多轮聊天、`/reset`、`/help`、群白名单、冷却/并发限制、事件去重与断线重连。建议使用专用 QQ 小号；NapCat 属于第三方客户端接入，兼容性、登录稳定性和账号风控受 QQ 影响。

## 一、准备文件和配置

Linux 服务器需要 Docker Engine 和 **Docker Compose v2**（`docker compose version` 可用）。NapCat 镜像项目支持 Linux amd64 / arm64。

将包含本次改动的项目目录放到服务器，在项目根目录操作：

```sh
# 已有 .env 时保留原配置，手动补充下面的项目
test -f .env || cp .env.example .env

# 生成一段随机 OneBot token，稍后同时填入 .env 和 NapCat WS 设置
openssl rand -hex 32
```

修改 `.env`，至少填写：

```dotenv
# 与 NapCat WebSocket 服务端的 token 完全相同
ONEBOT_ACCESS_TOKEN='刚刚生成的随机字符串'
# 必填：数字 QQ 群号，可写多个。空值不会启动聊天服务。
ONEBOT_GROUP_ALLOWLIST='123456789,987654321'
# 建议填写实际登录的 QQ 小号；留空则自动识别
ONEBOT_SELF_ID='你的机器人QQ号'

CHAT_API_KEY='你的模型APIKey'
CHAT_BASE_URL='https://api.deepseek.com/v1'
CHAT_MODEL='deepseek-chat'
CHAT_SYSTEM_PROMPT='你是群里的小助手，用中文自然简洁地回答。结合上下文理解追问，使用纯文本，不编造事实。'
```

模型服务需支持 OpenAI-compatible `/chat/completions`，接收 `model`、`messages`、`max_tokens`。例如可使用 DeepSeek、通义千问兼容接口或 OpenAI 中支持这些字段的聊天模型。API 地址必须是模型服务基址，不要再追加 `/chat/completions`。

`CHAT_API_KEY` / `CHAT_MODEL` 留空时分别回退到 `OPENAI_API_KEY` / `OPENAI_MODEL`；`CHAT_BASE_URL` 留空时回退到 `OPENAI_PROXY_URL`，再回退到 OpenAI 官方地址。QQ 官方版的 `QQ_APP_ID`、`QQ_APP_SECRET`、`QQ_GROUP_ALLOWLIST` 在本方案中不使用。

## 二、先启动 NapCat，登录普通 QQ

```sh
docker compose -f compose.qq.yaml up -d napcat
docker compose -f compose.qq.yaml logs --tail=80 napcat
```

在日志中找到 NapCat WebUI 地址和初始登录 token。这里的 **WebUI 登录凭证** 与上面的 **OneBot 接口 token** 不同。

Compose 只将 WebUI 发布到服务器 `127.0.0.1:6099`。在自己的电脑打开 SSH 隧道：

```sh
ssh -L 6099:127.0.0.1:6099 user@你的服务器地址
```

保持 SSH 连接，在本机浏览器打开 `http://127.0.0.1:6099/webui/`。按 NapCat 界面登录 WebUI，在「QQ 登录」页面显示二维码，使用准备好的 QQ 小号扫码。扫码后若 NapCat 重新生成 WebUI token 或要求修改密码，按当前界面和容器日志完成即可。

QQ 登录成功后，在 NapCat 的「网络配置」中新建 **WebSocket 服务端（正向 WS）**：

| 设置                             | 值                                          |
| -------------------------------- | ------------------------------------------- |
| 启用                             | 开启，保存时启用                            |
| Host                             | `0.0.0.0`（NapCat 容器内部）                |
| Port                             | `3001`                                      |
| 消息上报格式 / messagePostFormat | **array**                                   |
| token                            | 与 `.env` 的 `ONEBOT_ACCESS_TOKEN` 完全一致 |
| 上报自身消息 / reportSelfMessage | 关闭                                        |
| Debug                            | 关闭                                        |

选择的是 **WS 服务端**，不是 WS 客户端/反向 WS。WS 端口与 WebUI 的 6099 端口是两个不同服务。Compose 不将 OneBot 的 3001 端口发布到公网，聊天服务通过容器网络访问 `ws://napcat:3001`。

## 三、启动聊天服务

确认 `.env` 已填写模型及 OneBot 配置后执行：

```sh
docker compose -f compose.qq.yaml --profile chatbot up -d --build
docker compose -f compose.qq.yaml --profile chatbot logs -f chatbot
```

看到「已连接 NapCat 并确认 QQ 登录」后，将该 QQ 小号拉入白名单中的群，在群内测试：

```text
@小助手 推荐三本科幻小说
@小助手 哪一本适合第一次看科幻？
@小助手 /reset
@小助手 /help
```

机器人名字就是 QQ 昵称或群名片，在 QQ 中修改。**必须通过 QQ 的 @选择功能真正提及账号**，单纯输入文字 `@小助手`、@其他人、@全体成员不会触发。

`qq agent` / `npm run qq:agent` 现在默认使用普通 QQ。原官方版仍可通过 `qq official` / `npm run qq:official` 启动，见 [官方版指南](./qq-official-bot.zh-CN.md)。

## 四、自定义提示词和会话设置

除了修改 `CHAT_SYSTEM_PROMPT`，还可以编辑项目中的 `prompts/qq-system.txt`，并在 `.env` 设置：

```dotenv
CHAT_SYSTEM_PROMPT_FILE='./prompts/qq-system.txt'
```

Compose 将 `./prompts` 只读挂载到容器 `/app/prompts`，该相对路径在本机启动和容器里都能使用。文件必须是非空 UTF-8 文本；文件设置优先于内联提示词。

修改 `.env` 后重新执行 `docker compose -f compose.qq.yaml --profile chatbot up -d`，Compose 会更新环境变量。仅修改提示词文件时执行 `docker compose -f compose.qq.yaml --profile chatbot restart chatbot`。

| 设置                        | 默认值  | 作用                                        |
| --------------------------- | ------- | ------------------------------------------- |
| `ONEBOT_SELF_ID`            | 空      | 自动识别登录 QQ；配置后只允许该账号连接成功 |
| `ONEBOT_GROUP_ALLOWLIST`    | 必填    | 数字群号白名单，不是官方 group_openid       |
| `ONEBOT_REQUEST_TIMEOUT_MS` | 10000   | OneBot API 调用/连接握手超时                |
| `ONEBOT_RECONNECT_MS`       | 3000    | 初始重连间隔，连续失败逐渐增加到最多 30 秒  |
| `ONEBOT_MAX_PENDING`        | 32      | 最大在途消息处理数；满载时忽略新事件        |
| `CHAT_MAX_TURNS`            | 10      | 每个会话保留最近成功问答轮数                |
| `CHAT_SESSION_TTL_MS`       | 1800000 | 会话闲置 30 分钟过期，后续请求时清理        |
| `CHAT_MAX_SESSIONS`         | 1000    | 内存会话上限                                |
| `CHAT_COOLDOWN_MS`          | 2000    | 同一会话的模型调用冷却时间                  |
| `CHAT_MAX_CONCURRENT`       | 4       | 全局模型并发上限                            |
| `CHAT_MAX_INPUT_CHARS`      | 4000    | 单条输入长度限制                            |
| `CHAT_MAX_REPLY_CHARS`      | 1500    | 单条回复长度限制                            |
| `CHAT_TIMEOUT_MS`           | 45000   | 模型请求超时，最大 120000                   |
| `CHAT_MAX_TOKENS`           | 1000    | 传给模型的 `max_tokens`                     |

会话按「接入平台＋登录 QQ＋群号＋发言人 QQ」隔离，`/reset` 只清除当前用户在当前群的会话。回复仍然是群消息，群里其他人能看到。模型只接收触发问题及该会话历史，不接收整群普通聊天；机器人自己的发言不会再次触发。

第一版处理纯文字和文字引用中的真实 @。图片、语音、转发、文件等媒体消息、匿名消息和私聊被忽略。模型输出始终作为文本发送，即使含 `[CQ:...]` 也不会被解析成 @全体成员或其他消息操作。

## 五、Linux 直接运行 Node.js（不使用机器人容器）

需要 Node.js 20+。若 NapCat 也直接装在 Linux 上，在 NapCat WebUI 中创建监听 `127.0.0.1:3001` 的 WS 服务端，然后：

```dotenv
ONEBOT_WS_URL='ws://127.0.0.1:3001'
```

```sh
npm install
npm run qq:agent
```

如果 NapCat 在 Docker 中而 Node.js 在宿主机运行，请通过 Compose override 为 NapCat 额外发布 **回环端口** `127.0.0.1:3001:3001`，再使用上面的 URL；当前默认 Compose 没有该宿主机映射。NapCat 的 Linux 原生安装步骤参见 [项目安装文档](https://napneko.github.io/guide/boot/Shell)。

跨服务器接入应通过私网、SSH 隧道或 `wss://`，保留 Bearer token 鉴权。不要在 URL 查询参数中放 token；程序从 `ONEBOT_ACCESS_TOKEN` 设置 Authorization 请求头。

## 六、状态、维护与验收

```sh
docker compose -f compose.qq.yaml --profile chatbot ps
docker compose -f compose.qq.yaml --profile chatbot logs --tail=100 chatbot
# 停止服务，保留 NapCat 的登录状态和配置卷
docker compose -f compose.qq.yaml --profile chatbot down
```

NapCat QQ 登录数据保存在 `napcat-qq` 卷，配置保存在 `napcat-config` 卷。不要随意使用 `down -v`，它会删除这些数据。Compose 默认使用项目维护的 `mlikiowa/napcat-docker:latest`；验证某版本可用后可以用 `.env` 的 `NAPCAT_IMAGE` 固定版本标签或镜像 digest。

| 现象             | 排查方向                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| 一直无法连接     | WS 服务端是否启用、端口 3001、Docker 中是否监听 0.0.0.0、token 是否一致            |
| 提示无法确认登录 | 是否已扫码、QQ 是否掉线、`ONEBOT_SELF_ID` 是否与登录号一致                         |
| @没有回复        | 数字群号是否在白名单、是否真实 @该账号、上报格式是否为 array、是否包含不支持的媒体 |
| 收到模型失败提示 | CHAT_API_KEY、CHAT_BASE_URL、模型名、接口参数兼容性、余额/超时                     |
| 回复未发送       | QQ 禁言/风控、NapCat 返回失败、连接已换代；程序不会自动重发不确定的发送请求        |

代码离线验收：

```sh
npm run test:qq
```

测试通过本机模拟 WS/HTTP 验证鉴权、登录识别、@过滤、引用文本回复、上下文与重置、超时及重连。**这不等于 QQ 账号登录或实际群聊验收完成。** 实际部署后还应测试：普通聊天不回复、白名单群 @回复、非白名单群不回复、追问和重置正确、重启 NapCat 后能恢复连接。

会话与去重记录目前保存在单进程内存；重启聊天服务会清空。WS 断线或过载期间可能丢失消息，没有持久化消息队列。连接断开/换号后，旧连接产生的待回复会被丢弃；模型已经生成的答案可能留在上下文，可用 `/reset` 清除。服务关闭会等待在途任务结束；请保持单实例运行。

## 协议与镜像来源

- [NapCat 配置指南](https://napneko.github.io/config/basic)
- [NapCat Docker 项目](https://github.com/NapNeko/NapCat-Docker)
- [OneBot v11 正向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)
- [OneBot 鉴权](https://github.com/botuniverse/onebot-11/blob/master/communication/authorization.md)
- [OneBot 消息事件](https://github.com/botuniverse/onebot-11/blob/master/event/message.md)
