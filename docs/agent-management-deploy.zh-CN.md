# Agent 管理台部署指南（Linux / Docker）

本指南在现有 NapCat + 普通 QQ 部署基础上，启用管理模式。管理模式运行管理 API、托管浏览器管理台、连接 NapCat 处理消息，并可选启动隔离文件执行器。先阅读 [普通 QQ 机器人指南](./qq-personal-bot.zh-CN.md) 完成 NapCat 安装；QQ 扫码及管理端所需的正向 WebSocket 可在管理台配置。

## 1. 准备密钥与目录

```sh
mkdir -p secrets resources/notes
openssl rand -hex 32 | tee secrets/master.key
openssl rand -hex 32 > .executor-secret
```

`master.key` 用于加密模型/搜索 API Key，丢失后已存凭据无法解密；`executor-secret` 用于文件执行器请求签名，两者不要相同。`resources/notes` 是默认允许 Agent 读写的工作目录，只挂载你明确授权的目录。

容器以 uid 10001 运行（management 用户 `mgmt`、执行器用户 `executor`）。数据卷会自动继承镜像目录权限；**bind 挂载的 `resources` 目录需要把写权限交给 uid 10001**：

```sh
sudo chown -R 10001:10001 resources
```

升级前创建过的 `management-data` 卷如果仍由 root 持有，数据库无法创建，会出现 `SQLITE_CANTOPEN`。没有需要保留的数据时直接重建卷：

```sh
sudo docker compose -f compose.qq.yaml --profile management down
sudo docker volume ls | grep management-data
sudo docker volume rm <上一步查到的卷名>
```

之后重新 `up -d --build management` 即可。若已有重要数据，改用容器内 chown：

```sh
sudo docker compose -f compose.qq.yaml --profile management run --rm --user root management chown -R 10001:10001 /app/data
```

## 2. 配置 .env

在 `.env` 中确认或补充：

```dotenv
ONEBOT_ACCESS_TOKEN='与 NapCat WS 一致的 token'
ONEBOT_GROUP_ALLOWLIST='123456789'
ONEBOT_PRIVATE_ENABLED='true'
ONEBOT_PRIVATE_ALLOWLIST='987654321'
ONEBOT_BOT_ACCOUNT_ID='imported-bot'
# 仅当管理端无法读取 NapCat 配置卷内的 WebUI token 时填写
NAPCAT_WEBUI_SECRET_KEY=''

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

管理端依赖阶段使用带编译工具的 Node 镜像，跳过无关的 Puppeteer 浏览器下载；运行阶段仍使用 slim 镜像。首次构建需要拉取构建镜像和安装 npm 依赖；后续只修改 `src` 或前端源码时，依赖层会命中 Docker 缓存。重新构建时可以用以下命令查看每一步的耗时：

```sh
docker compose --progress plain -f compose.qq.yaml --profile management build management
docker compose -f compose.qq.yaml --profile management up -d --no-build management
```

首次启动后创建管理员并导入旧配置：

```sh
docker compose -f compose.qq.yaml --profile management exec management node --input-type=module -e \
  "import { bootstrapOwner } from './src/management/cli/bootstrap.js'; await bootstrapOwner({ databaseFile: process.env.MANAGEMENT_DB })"
docker compose -f compose.qq.yaml --profile management exec -T management node src/management/cli/import-env.js /dev/stdin --dry-run < .env
docker compose -f compose.qq.yaml --profile management exec -T management node src/management/cli/import-env.js /dev/stdin < .env
```

第一个命令会交互询问管理员用户名和密码；已有 owner 时不必重复执行。导入命令从宿主机标准输入读取 `.env`，不要求把文件挂载到容器。导入前确认 `.env` 中设置了 `CHAT_API_KEY`、`CHAT_BASE_URL`、`CHAT_MODEL`。若已知道机器人的 QQ 号，可填写 `ONEBOT_SELF_ID` 与白名单一起导入；暂时不知道也可以先导入 Agent，扫码后在「QQ 权限」选择默认 Agent 并添加群聊或私聊白名单。

导入会建立“默认 Agent”、加密保存 API Key、把群/私聊白名单与触发规则写入数据库，并预置 7 项对话设定。用户默认都是 L0，不会因导入获得搜索或文件权限。

## 4. 打开管理台

管理台只监听服务器回环地址 6080。在自己电脑打开 SSH 隧道：

```sh
ssh -L 6080:127.0.0.1:6080 ubuntu@你的服务器IP
```

浏览器打开 [http://127.0.0.1:6080](http://127.0.0.1:6080)，用 bootstrap 创建的管理员登录。进入「QQ 权限」可看到 NapCat 的登录状态或可扫描的二维码；扫码后页面自动识别当前 QQ 号。管理端从只读配置卷读取 WebUI token，仅服务端向 NapCat 发起鉴权；若页面提示无法读取凭证，请把现有 WebUI token 填入 `.env` 的 `NAPCAT_WEBUI_SECRET_KEY`，再执行 `docker compose -f compose.qq.yaml --profile management up -d management` 使环境变量生效。NapCat 在首次扫码后可能更新 WebUI token：管理端优先读取配置卷中的当前值；若只能使用环境变量作为后备，需要同步更新它。WebUI token 与 `ONEBOT_ACCESS_TOKEN` 是两个不同的凭证。

## 5. 日常操作

- Agent 发布采用草稿/发布模型：编辑 Prompt、模型、0–1 设定与回复节奏后保存草稿，再点击“发布版本”，下一轮对话生效；停用/归档立即阻止新请求。
- 在“QQ 权限”按步骤操作：先扫码并确认 QQ 号及 NapCat 消息连接；若缺少管理端正向 WebSocket 服务，可在连接区创建。再选择已发布的默认 Agent，配置白名单、单独绑定和发言者工具授权，最后点击“保存配置并查看结果”。已有白名单可以点“编辑”回填表单；结果页可展开单独绑定与授权详情。回到页面时可点击“查看已保存配置”。一个 NapCat 容器同一时间只登录一个 QQ 号，曾登录帐号的配置会保留。
- 白名单中的 L0 仅能聊天；L1 允许申请联网搜索和表情包，L2 增加文件列表与读取，L3 增加文件创建和修改。级别是上限，L1–L3 还要同时满足 Agent 的能力开关、发言者授权；文件操作另需 Agent 资源授权，写入遵守审批规则。管理页可使用“路由预览”核对命中的 Agent 和级别，预览不发送 QQ 消息。
- 在“会话记录”查看每个账号的对话；清除上下文与删除历史是两种不同操作。
- 文件写入默认走审批：Agent 准备修改后，在“工具与资源”确认差异并批准；专用低风险目录可在文件资源上开启自动写入。
- 备份：`docker compose ... exec management node src/management/cli/backup.js /app/data/backup.sqlite`，并将数据库与 master.key 分开保存。

## 6. 回滚

停止管理模式（`--profile management down`），保存数据库与密钥，再按旧指南用 `--profile chatbot up -d --build` 启动旧版；不要同时运行两个模式消费同一 QQ。NapCat 登录卷保持不动。
