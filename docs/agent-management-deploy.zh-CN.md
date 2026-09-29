# Agent 管理台部署指南（Linux / Docker）

本指南在现有 NapCat + 普通 QQ 部署基础上，启用管理模式。管理模式运行管理 API、托管浏览器管理台、连接 NapCat 处理消息，并可选启动隔离文件执行器。先阅读 [普通 QQ 机器人指南](./qq-personal-bot.zh-CN.md) 完成 NapCat 登录。

## 1. 准备密钥与目录

```sh
mkdir -p secrets resources/notes
openssl rand -hex 32 | tee secrets/master.key
openssl rand -hex 32 > .executor-secret
```

`master.key` 用于加密模型/搜索 API Key，丢失后已存凭据无法解密；`executor-secret` 用于文件执行器请求签名，两者不要相同。`resources/notes` 是默认允许 Agent 读写的工作目录，只挂载你明确授权的目录。

## 2. 配置 .env

在 `.env` 中确认或补充：

```dotenv
ONEBOT_ACCESS_TOKEN='与 NapCat WS 一致的 token'
ONEBOT_GROUP_ALLOWLIST='123456789'
ONEBOT_PRIVATE_ENABLED='true'
ONEBOT_PRIVATE_ALLOWLIST='987654321'
ONEBOT_BOT_ACCOUNT_ID='imported-bot'

CHAT_API_KEY='模型服务密钥'
CHAT_BASE_URL='https://api.deepseek.com'
CHAT_MODEL='deepseek-chat'

MANAGEMENT_KEY_FILE='./secrets/master.key'
FILE_EXECUTOR_SECRET='填入刚才生成的 executor-secret'
RESOURCE_MANIFEST='notes=/resources/notes'
```

## 3. 启动管理模式

先停止旧版聊天机器人，避免与新模式重复回复：

```sh
docker compose -f compose.qq.yaml --profile chatbot down
docker compose -f compose.qq.yaml --profile management up -d --build management file-tools
docker compose -f compose.qq.yaml --profile management logs -f management
```

首次启动后创建管理员并导入旧配置：

```sh
docker compose -f compose.qq.yaml --profile management exec management node src/management/cli/bootstrap.js
docker compose -f compose.qq.yaml --profile management exec management node src/management/cli/import-env.js .env --dry-run
docker compose -f compose.qq.yaml --profile management exec management node src/management/cli/import-env.js .env
```

导入会建立“默认 Agent”、加密保存 API Key、把群/私聊白名单与触发规则写入数据库，并预置 7 项对话设定。用户默认都是 L0，不会因导入获得搜索或文件权限。

## 4. 打开管理台

管理台只监听服务器回环地址 6080。在自己电脑打开 SSH 隧道：

```sh
ssh -L 6080:127.0.0.1:6080 ubuntu@你的服务器IP
```

浏览器打开 [http://127.0.0.1:6080](http://127.0.0.1:6080)，用 bootstrap 创建的管理员登录。

## 5. 日常操作

- Agent 发布采用草稿/发布模型：编辑 Prompt、模型、0–1 设定与回复节奏后保存草稿，再点击“发布版本”，下一轮对话生效；停用/归档立即阻止新请求。
- 在“QQ 权限”维护群/私聊白名单、Agent 绑定与路由预览；绑定的 Agent 只决定角色，不自动授予权限。
- 在“会话记录”查看每个账号的对话；清除上下文与删除历史是两种不同操作。
- 文件写入默认走审批：Agent 准备修改后，在“工具与资源”确认差异并批准；专用低风险目录可在文件资源上开启自动写入。
- 备份：`docker compose ... exec management node src/management/cli/backup.js /app/data/backup.sqlite`，并将数据库与 master.key 分开保存。

## 6. 回滚

停止管理模式（`--profile management down`），保存数据库与密钥，再按旧指南用 `--profile chatbot up -d --build` 启动旧版；不要同时运行两个模式消费同一 QQ。NapCat 登录卷保持不动。
