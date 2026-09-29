# Agent 管理台验收记录

状态：代码与自动化测试已完成，真实 QQ 部署尚未在本机执行。

## 已自动化验证

| 范围                                     | 结果 | 证据                                          |
| ---------------------------------------- | ---- | --------------------------------------------- |
| 数据库迁移与约束                         | 通过 | `npm run test:management`                     |
| 认证、CSRF、范围授权                     | 通过 | auth 与 api 测试                              |
| 凭据 AES-256-GCM 加密、无明文回显        | 通过 | crypto 与 api 测试                            |
| Agent 草稿/发布/回滚/停用/归档           | 通过 | agents service 与 api 测试                    |
| 动态 0–1 设定编译、0 语义、定义停用      | 通过 | styles compiler 测试                          |
| 回复节奏计算与继承（0 覆盖）             | 通过 | pacing 测试                                   |
| QQ 解析、白名单、触发、路由预览          | 通过 | normalize 与 router 测试                      |
| 会话去重/隔离/上下文/保留期              | 通过 | conversations 与 history 测试                 |
| 权限交集、命令注册与执行                 | 通过 | policy 与 commands 测试                       |
| 运行器、发送调度、reset 取消、重启不补发 | 通过 | scheduler 与 runtime 测试                     |
| 联网搜索与网络出口策略                   | 通过 | search 与 provider-network 测试               |
| 表情上传校验与发送约束                   | 通过 | memes 测试                                    |
| 文件执行器路径/哈希/签名/审批            | 通过 | Python unittest 与 file-client/approvals 测试 |
| 旧配置导入幂等、租约互斥                 | 通过 | migration 测试                                |
| 前端登录与 API 客户端                    | 通过 | `npm --prefix apps/admin-web run test`        |
| 前端构建                                 | 通过 | `npm --prefix apps/admin-web run build`       |
| QQ 旧链路回归                            | 通过 | `npm run test:qq`（78 项）                    |

## 待真实环境验证

- Ubuntu 上 `docker compose --profile management up -d --build` 镜像构建与启动。
- NapCat 扫码登录与真实群/好友收发、按节奏等待、表情图、搜索引用、白名单目录写入。
- 管理模式与旧 chatbot 的切换（单消费者租约在共享卷内验证）。
- 浏览器端到端操作（Playwright 浏览器自动化未在本机安装浏览器）。

以上项需在用户提供的 Ubuntu 测试环境执行；离线测试通过不代表 QQ 账号实际可用。
