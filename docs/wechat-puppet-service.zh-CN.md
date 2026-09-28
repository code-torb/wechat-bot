# 使用第三方 Wechaty Puppet Service 登录个人微信

本项目支持在原 `wechat4u` 与第三方 Wechaty Puppet Service 之间切换。Puppet Service 是 Wechaty 的远程协议接口，本身不提供微信账号；需要先选择能够接入**个人微信**、且明确兼容 `wechaty-puppet-service@1.19.9` 与本项目 `wechaty@1.20.2` 的服务商。仅有 HTTP/WebSocket API、所谓“iPad token”或 AI API Key 的服务不能直接填进这套配置。

## 1. 向服务商确认

索取 Puppet Service token、是否需要直连 gRPC endpoint（`host:port`）、TLS/SNI 设置、适配的 Wechaty 版本、登录/会话恢复规则，以及普通群消息和真实 @ 的支持方式。先用测试账号验证收消息、发消息、断线重连和进程重启。第三方协议仍可能需要首次扫码，无法保证免扫码或永久在线。

## 2. 在 Windows 本机配置

在安装 Node.js 18 或更新 LTS 版的电脑上，打开 PowerShell，进入项目目录并安装依赖：

```powershell
npm install
Copy-Item .env.example .env
```

如果 `.env` 已经存在，不执行 `Copy-Item` 覆盖它。编辑 `.env` 中以下项目：

```dotenv
WECHAT_TRANSPORT='service'
WECHATY_PUPPET_SERVICE_TOKEN='服务商提供的 Puppet Service token'
WECHATY_PUPPET_SERVICE_ENDPOINT=''

BOT_NAME='@机器人微信昵称'
ALIAS_WHITELIST='允许自动回复的好友备注或昵称'
ROOM_WHITELIST='允许自动回复的群名'
```

仅在服务商给出直连地址时填写 `WECHATY_PUPPET_SERVICE_ENDPOINT='host:port'`；否则留空，让 Puppet Service 用 token 发现服务。若服务商要求自定义 TLS 根证书或 SNI，按其文档设置 `WECHATY_PUPPET_SERVICE_TLS_CA_CERT` / `WECHATY_PUPPET_SERVICE_TLS_SERVER_NAME`。不要通过关闭 TLS 校验解决证书错误。

另按所选 AI 服务配置模型凭据。例如使用 `deepseek-free` 时，需配置其 URL、token 和模型名；这些凭据与微信 Puppet Service token 不同。

## 3. 启动与验收

```powershell
npm run test:wechat-transport
npm run start -- start --serve deepseek-free
```

把 `deepseek-free` 换成实际已配置的 AI 服务。若使用 Pi，则运行 `npm run agent`。启动后依照服务商流程完成登录；观察控制台出现 `has logged in`，再用白名单好友和白名单群分别测试收发。群消息需要包含 `.env` 中的 `BOT_NAME`；不同 Puppet 对 @ 的文本表示可能不同，务必实测。

服务模式使用独立的 `WechatEveryDay-service` 会话文件名，不复用旧 `WechatEveryDay` 的 Web 协议登录状态。有效会话能否在重启后恢复取决于服务商。只运行一个机器人进程，避免重复回复。

如果启动提示缺少 `WECHATY_PUPPET_SERVICE_TOKEN`，说明尚未设置服务商 token；如果 gRPC 连接或 TLS 报错，先核对服务商给出的 endpoint、证书和 SNI。`WECHAT_LOGIN_DEBUG` 只诊断旧 `wechat4u`，不诊断 Puppet Service。日志和问题反馈中不要粘贴 token、Cookie、二维码链接或完整会话文件。

切回旧协议时将 `WECHAT_TRANSPORT='wechat4u'`，旧协议的 `webwxinit Ret=1` 问题仍可能存在。
