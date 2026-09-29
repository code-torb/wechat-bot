# Agent Management Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 实施状态：T01–T17 代码已按本计划实现并通过自动化测试；真实 Ubuntu/NapCat 验收待执行，见 docs/agent-management-acceptance.md。Steps use checkbox syntax for tracking.

**Goal:** 在现有 QQ/NapCat 项目上交付支持多 Agent、密钥加密、动态对话设定、回复节奏、授权工具和历史记录的管理台。

**Architecture:** 单个 Node.js 应用运行管理 API 与一个 QQ 消费者，SQLite 保存配置和执行状态。复用 OneBot 连接层，新增 Agent 运行器、会话队列和可取消回复计划。文件操作通过独立的受限 Python 执行器完成。

**Tech Stack:** Node.js 22 LTS ≥22.14、JavaScript ESM、Fastify 5、better-sqlite3、React 19、TypeScript、Vite、Ant Design 5、Python 3.12、Docker Compose。

## Global Constraints

- 依据 [产品 Design](../../design/agent-management.md) 和 [实现方案设计](../../design/agent-management-implementation.md)。
- 本轮只编写方案，不安装依赖、不启动服务、不修改业务代码、不推送部署。
- 第一版只管理当前 QQ，支持群白名单与好友私聊白名单；绑定不等于授权。
- API Key 使用 AES-256-GCM 加密，主密钥独立文件，前端与日志不返回明文。
- Agent能力 ∩ 场景能力 ∩ 发言人能力 ∩ 资源授权共同决定有效权限。
- 0–1 参数步长0.01，每 Agent 最多20项；0不是禁用，未选择才不生效。
- 回复延迟默认0，字符速率默认0，上限默认15000ms；与CHAT_COOLDOWN_MS独立。
- 每会话普通消息队列默认8条、全局256条、模型并发4；工具每轮最多6次和3轮往返。
- 群触发支持真实@、有边界的开头短语、精确匹配；不开放任意正则或默认全群自动回复。
- 保留旧 CLI 回归；管理模式和旧CLI不能同时消费相同QQ连接。
- 白名单文件仅支持列出/读取/创建/修改；没有任意Shell、删除或改权限工具。
- 真实QQ/模型调用与离线测试分开，不能未经授权向实际群发测试消息。

---

## 1. 执行方式与依赖

分为五个可验收工作包，分别审查、提交；中间阶段不对外宣称完整上线。

| 工作包       | 任务    | 交付结果                                       |
| ------------ | ------- | ---------------------------------------------- |
| A 配置与身份 | T01–T04 | 可用的配置 API、登录、密钥、Agent/动态设定版本 |
| B 消息运行   | T05–T08 | 路由、历史、命令、独立会话和可控发送           |
| C 工具执行   | T09–T11 | 搜索、表情、权限、白名单文件和审批             |
| D 管理界面   | T12–T14 | 所有管理页面与浏览器操作闭环                   |
| E 部署迁移   | T15–T17 | 导入、单消费者、部署、恢复和端到端验收         |

依赖：T01→T02→T03→T04；T03+T04→T05→T06→T07→T08；T06+T07→T09→T10/T11；T02+T04→T12，T05+T08→T13，T09+T10+T11→T14；T01–T14→T15→T16→T17。

前端可在稳定 API 契约完成后独立推进，但本计划不自动派发代理。文件归属按任务表，避免同时编辑根依赖、公共schemas或同一Compose文件。

每任务按“新增行为测试→观察预期失败→实现→通过相关测试→审查差异→提交”执行。以下测试代码是目标接口的验收样例，尚未运行；实现步骤中的文件均为拟新增/修改路径。

公共脚本：T01添加`test:management`（管理模块相邻测试及tests/management测试），T12添加前端`test/build`，T14添加`test:e2e`。单项测试使用文档列出的精确文件命令，完整脚本在文件存在后执行。

## 2. 任务清单

### T01：SQLite 基础、迁移和应用入口

**Files:** 新增 src/management/db/{index.js,migrate.js,migrations/001-control.sql,migrations/002-runtime.sql}、src/management/{app.js,main.js,schemas.js}、tests/management/schema.test.js；修改 package.json、.gitignore；新增/跟踪 package-lock.json。

**Interfaces:** `openDatabase({filename}) → db`；`migrate(db) → version`；`createApp({db,clock,secretStore,modelClient,onebotClient}) → FastifyInstance`；db 提供close/prepare/transaction。测试使用临时文件或`:memory:`，生产路径来自启动配置。

- [ ] 建立schema测试：迁移两次结果相同；跨Agent重复版本、重复binding、非法style value被数据库拒绝；关闭重开文件数据仍在。
- [ ] 运行 `node --test tests/management/schema.test.js`，观察迁移接口缺失或约束未生效导致失败。
- [ ] 安装并锁定依赖；创建实现方案第4节全部表/索引/FK，migrations表记录校验和，连接启用foreign_keys/WAL/busy_timeout=5000；createApp关闭时释放DB和资源。
- [ ] 运行schema测试与`npm run test:qq`，确认旧CLI未受依赖变更影响。
- [ ] 提交 `feat(management): add database migrations and application bootstrap`。

目标样例：

```js
const db = openDatabase({ filename: ':memory:' })
assert.equal(migrate(db), 2)
assert.equal(migrate(db), 2)
assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1)
db.close()
```

### T02：登录、后台范围授权与凭据保险库

**Files:** 新增 src/management/auth/{passwords.js,sessions.js,authorization.js,routes.js,auth.test.js}、src/management/secrets/{crypto.js,store.js,routes.js,crypto.test.js}、src/management/cli/bootstrap.js；修改app.js/schemas.js。

**Interfaces:** `seal({plaintext,aad,key,keyVersion}) → {cipher,nonce,tag,keyVersion}`；`unseal({envelope,aad,key}) → plaintext`；`SecretStore.withSecret(ref,callback)`；后台请求身份为`{userId,role,scopes}`。

- [ ] 写测试：相同明文使用不同nonce；错AAD或篡改解密失败；登录后授权有效、过期或撤销无效；Operator不能读其他Agent或创建全局授权；凭据API无明文字段。
- [ ] 运行 `node --test src/management/secrets/crypto.test.js src/management/auth/auth.test.js`，确认未实现行为失败。
- [ ] 实现AES-GCM及独立master-key读取、Argon2id、随机会话令牌哈希存储、CSRF/Origin、对象级授权、bootstrap交互密码；Fastify日志按字段脱敏并使用固定错误code。
- [ ] 测试provider变更必须重新加密、凭据删除引用检查、登录限频、Cookie属性与注销。
- [ ] 提交 `feat(management): add authentication and encrypted credentials`。

目标样例：

```js
const key = Buffer.alloc(32, 7)
const a = seal({ plaintext: 'fake-key', aad: 'credential-a:provider-a:model:1', key, keyVersion: 1 })
const b = seal({ plaintext: 'fake-key', aad: 'credential-a:provider-a:model:1', key, keyVersion: 1 })
assert.notDeepEqual(a.nonce, b.nonce)
assert.throws(() => unseal({ envelope: a, aad: 'credential-b:provider-a:model:1', key }))
```

### T03：Agent CRUD、不可变版本与发布

**Files:** 新增 src/management/agents/{repository.js,service.js,routes.js,service.test.js}、src/management/audit/{store.js,routes.js}；修改schemas.js。

**Interfaces:** `AgentService.create({actorId,name})`、`updateDraft({agentId,expectedRevision,patch,actorId})`、`publish({agentId,expectedRevision,actorId})`、`rollback({agentId,versionId,expectedRevision,actorId})`；发布返回设计中AgentVersion。

- [ ] 写用例：草稿不改变运行配置；两人同时编辑只有一次成功；回滚生成新版本；停用后不能接受新轮次；绑定引用阻止删除；复制没有明文密钥。
- [ ] 运行 `node --test src/management/agents/service.test.js`，确认缺失版本行为失败。
- [ ] 用短事务更新draft revision/版本/发布指针/审计；所有外键引用检查凭据与模型授权；软归档保留历史，彻底删除只能在引用解除后显式执行。
- [ ] 用临时SQLite验证事务回滚后没有孤立版本或半发布Agent。
- [ ] 提交 `feat(management): add versioned agent lifecycle`。

验收关键断言：发布A后编辑草稿B，`getPublished(agentId).prompt`仍是A；第二次发布才为B。`getPublished(agentId)`由本任务AgentService提供。

### T04：动态0–1设定、编译器与回复节奏配置

**Files:** 新增 src/management/styles/{repository.js,compiler.js,routes.js,compiler.test.js}、src/chat/{pacing.js,pacing.test.js}；修改agents/service.js、schemas.js、src/chat/config.js、.env.example、compose.qq.yaml。

**Interfaces:** `StyleCompiler.compile({prompt,definitions,values}) → {systemText,appliedStyles}`；`calculateReplyDelay(text,pacing) → milliseconds`；`resolvePacing({system,agent,scope}) → Pacing`，字段按nullish继承。

- [ ] 写测试覆盖自定义设定新增、不加表列；0/1/0.01精度、越界、重复key；修改默认值不覆盖既有值；定义停用影响新轮次；0覆盖继承；60字符等待6500ms。
- [ ] 运行 `node --test src/management/styles/compiler.test.js src/chat/pacing.test.js`，确认缺失编译/节奏行为失败。
- [ ] 定义库与Agent值分开保存；快照钉住定义版本；编译结果限制32000字符；新增三项CHAT_REPLY配置解析及Compose透传，但发送实现由T08接入。
- [ ] 通过单测，检查非法速率/延迟组合拒绝，memeFrequency是保留程序绑定，自定义设定不能注册工具。
- [ ] 提交 `feat(management): add dynamic conversation settings and reply pacing`。

目标样例：

```js
assert.equal(
  calculateReplyDelay('字'.repeat(60), {
    baseDelayMs: 1500,
    charsPerSecond: 12,
    maxDelayMs: 12000,
  }),
  6500,
)
assert.equal(
  resolvePacing({
    system: { baseDelayMs: 1500, charsPerSecond: 12, maxDelayMs: 12000 },
    agent: {},
    scope: { baseDelayMs: 0, charsPerSecond: 0 },
  }).baseDelayMs,
  0,
)
```

### T05：QQ解析、访问规则、触发与Agent路由

**Files:** 新增 src/platforms/onebot/{normalize.js,normalize.test.js}、src/management/qq/{rules.js,router.js,routes.js,router.test.js}；修改旧messages.js以复用解析但保留旧CLI过滤行为。

**Interfaces:** `normalizeOneBotEvent({event,identity,botAccountId}) → InboundMessage|null`；`QQRouter.resolve({message}) → 路由结果`；`QQRouter.preview({botAccountId,scene,peerId,senderId,text,mentionedSelf}) → 同一规则解释`。

- [ ] 写测试：群未授权即使个人绑定也拒绝；群内用户优先群默认；私聊绑定独立；没有@但合法前缀可触发；模糊子串不触发；非好友私聊拒绝。
- [ ] 运行 `node --test src/platforms/onebot/normalize.test.js src/management/qq/router.test.js`。
- [ ] 从旧过滤器抽出纯结构解析；DB作用域唯一键保证无歧义；禁用Agent不隐式fallback；preview调用真实决策模块但不保存消息/调用模型。
- [ ] 运行旧messages测试与新路由测试，验证旧CLI保持真实@规则和私聊白名单。
- [ ] 提交 `feat(management): add scoped QQ routing and trigger rules`。

最小验收夹具：bot=12345、group=34567、sender=23456；先禁用group再给group_user绑定Agent，`resolve`必须返回`accepted:false`。

### T06：持久会话、去重、上下文与清理

**Files:** 新增 src/management/conversations/{repository.js,context.js,routes.js,context.test.js}、src/management/operations/retention.js、tests/management/history.test.js。

**Interfaces:** `ConversationStore.accept({message,agentVersionId}) → {duplicate,conversationId,epoch,runId}`；`getContext({conversationId,epoch,maxTurns,maxTokens})`；`reset({conversationId,actor}) → {epoch}`。

- [ ] 写测试：同eventKey仅一个run；群/私聊/用户/Agent隔离；重启可查；只有文本已送达成功轮次进入上下文；reset保留历史但增加epoch。
- [ ] 运行 `node --test src/management/conversations/context.test.js tests/management/history.test.js`。
- [ ] 消息接纳/去重/run插入放同一短事务；提供游标分页、授权过滤、导出与删除；默认消息30天、审计90天，仅清理终态且不删除待审批引用。
- [ ] 验证删除包含messages/tool结果/导出缓存的关联处理；审计保留无正文操作摘要，导出需独立范围授权。
- [ ] 提交 `feat(management): persist conversations and delivery-aware context`。

验收数据：先写一轮SENT、一轮UNKNOWN，再getContext，结果包含第一轮问答但不包含第二轮；不把失败的用户提问单独拼成历史成功轮次。

### T07：统一权限与命令注册

**Files:** 新增 src/management/permissions/{policy.js,grants.js,routes.js,policy.test.js}、src/management/commands/{registry.js,executor.js,routes.js,commands.test.js}。

**Interfaces:** `PolicyEngine.authorize({context,capability,resourceId})`；`CommandRegistry.match({agentVersion,text}) → command|null`；`CommandExecutor.execute({context,command,args}) → Reply或pending审批结果`。

- [ ] 写测试：L3Agent+L0用户拒绝文件；群禁文件覆盖用户授权；help只列有效命令；reset不能操作他人；别名冲突拒绝；工作流第6步或循环拒绝。
- [ ] 运行 `node --test src/management/permissions/policy.test.js src/management/commands/commands.test.js`。
- [ ] 实现能力集合交集与资源输出范围；命令输入Schema/限频/固定处理器；移除新运行器对旧核心内置help/reset的依赖；未知命令返回帮助，不能升级为任意执行。
- [ ] 验证所有工具入口和命令工具步骤都调用authorize，没有仅靠Agent级别的快捷路径。
- [ ] 提交 `feat(management): enforce scoped permissions and configurable commands`。

权限矩阵至少覆盖：L0用户/L3Agent、L3用户/L0Agent、同用户跨群、同用户群转私聊、资源未授权、资源仅read、审批后撤权。

### T08：Agent运行器、发送计划和旧CLI节奏

**Files:** 新增 src/management/runtime/{runner.js,session-queue.js,reply-plans.js,scheduler.js,scheduler.test.js}、src/management/qq/consumer.js、src/platforms/onebot/render.js、tests/management/runtime.test.js；修改src/platforms/onebot/{client.js,agent.js,messages.js}、src/chat/core.js。

**Interfaces:** AgentRuntime.accept、ReplyScheduler.schedule遵循实现方案；`ReplyScheduler.cancel({conversationId,epoch,reason})`；`renderReply({message,reply,quote}) → action/params parts`。

- [ ] 用可控clock写测试：dueAt前不发、到时发一次；等待释放模型槽；同会话普通轮次顺序；help立即；reset/撤权/停用/断线取消；重启不补发。
- [ ] 运行 `node --test src/management/runtime/scheduler.test.js tests/management/runtime.test.js`。
- [ ] 落地状态机、队列上限、配置快照、复查门禁与OneBot错误分类；发送成功后提交上下文。旧CLI通过公共pacing和可取消等待接入同样节奏语义，默认0保持现状。
- [ ] 运行`npm run test:qq`与管理运行测试，验证group/private发送目标、CQ不执行、UNKNOWN不重发、reset在等待期可用。
- [ ] 提交 `feat(management): add agent execution and cancellable reply scheduling`。

测试时序：t=0模型完成、dueAt=6500；推进6499ms应0次发送；再1ms应1次；另一会话在等待期间能完成模型调用。另例t=1000 reset，推进到7000仍0次发送。

### T09：模型工具调用、搜索和网络策略

**Files:** 新增 src/chat/{model-client.js,model-client.test.js}、src/management/tools/{registry.js,executor.js,search.js,search.test.js}、src/management/secrets/provider-network.js；修改runner.js。

**Interfaces:** ModelClient.complete返回ModelResult；`ToolExecutor.execute({context,call})`；`searchWeb({query,limit,credentialRef,signal}) → {results:[{title,url,snippet}],fetchedAt}`。

- [ ] 用本机假HTTP写测试：tool_calls参数错误拒绝、自动模式不兼容拒绝发布、显式search可用、最多2次搜索/5条结果、失败不伪造来源、工具循环超限停止。
- [ ] 运行 `node --test src/chat/model-client.test.js src/management/tools/search.test.js`。
- [ ] 实现凭据服务端消费、固定Brave适配、受限工具往返；测试网络策略时通过注入transport允许本机假服务，生产默认拒绝内网/元数据和任意重定向。
- [ ] 验证tool结果是低信任数据，网页指令不能改变权限；请求日志无Authorization；完整消息历史不作为检索参数发送。
- [ ] 提交 `feat(management): add permissioned search and model tool calls`。

失败样例断言：provider超时返回固定`MODEL_TIMEOUT`，search超时返回`SEARCH_UNAVAILABLE`，错误体不得包含假密钥`fixture-secret-value`。

### T10：表情素材与结构化图片回复

**Files:** 新增 src/management/tools/{memes.js,routes.js,memes.test.js}；修改render.js、runner.js、reply-plans.js。

**Interfaces:** `MemeService.upload({actor,file,tags}) → assetMetadata`；`select({context,assetId,lastMemeTurn,frequency,scene}) → asset|null`；`readAuthorizedAsset({context,assetId}) → {mime,buffer}`。

- [ ] 写测试：伪装HTML/SVG拒绝、2MB上限、未知素材ID拒绝、未授权拒绝、同轮最多1张、三轮冷却、严肃/审批场景不发。
- [ ] 运行 `node --test src/management/tools/memes.test.js`。
- [ ] 上传校验真实格式与像素尺寸，UUID命名，素材授权/停用；使用base64构造OneBot图片，不接受模型任意URL；每part保存发送结果。
- [ ] 模拟文字成功图片失败，确认不会重发文字，历史仍能展示部分失败。
- [ ] 提交 `feat(management): add curated meme assets and delivery tracking`。

### T11：白名单文件、审批和隔离执行器

**Files:** 新增 services/file-executor/{main.py,protocol.py,paths.py,operations.py,journal.py,test_operations.py,Dockerfile}、src/management/tools/{file-client.js,file-client.test.js}、tests/management/approvals.test.js；修改permissions及tools routes。

**Interfaces:** Unix socket请求`{id,runId,resourceId,action,relativePath,expectedHash,content?,nonce,expiresAt,signature}`；响应`{id,status,resultHash?,errorCode?}`；action固定list/read/prepare_write/commit_write。

- [ ] 先写Linux测试覆盖..、绝对路径、symlink/hardlink、设备文件、旧hash、审批过期、重复nonce、缺授权、崩溃后UNKNOWN。
- [ ] 在Linux执行器测试容器运行 `python -m unittest discover -s . -p 'test_*.py'`，确认缺失限制失败。
- [ ] 实现dir_fd/O_NOFOLLOW逐级打开、临时文件/fsync/replace、私有备份与操作日志；Node负责审批CAS、用户/资源复查、HMAC请求；执行器再限制manifest资源。
- [ ] 运行文件测试与`node --test src/management/tools/file-client.test.js tests/management/approvals.test.js`，验证审批后改文件产生409，旧票据不能覆盖。
- [ ] 提交 `feat(management): add scoped file executor and write approvals`。

文件关键测试：临时根内建立指向根外的symlink，调用read/update必须拒绝；同名合法普通文件可读写且只改变目标文件。测试不接触用户真实目录。

### T12：管理端壳、Agent编辑和动态设定

**Files:** 新增 apps/admin-web/package.json、package-lock.json、vite.config.ts、tsconfig.json、src/{app.tsx,api/client.ts,api/generated.ts,styles.css}、pages/{login,overview,agents,styles}/、components/{AgentEditor,StyleEditor,PacingEditor}.tsx及组件测试。

**Interfaces:** 只消费T02–T04 API；生成类型来自OpenAPI；表单null表示继承，0作为显式值提交。

- [ ] 用Testing Library写测试：登录跳转、范围隐藏与服务器拒绝、新Agent草稿/发布、凭据空输入保留、新设定定义+绑定、0值保存与预计延迟展示。
- [ ] 运行 `npm --prefix apps/admin-web run test`，确认页面/交互缺失失败。
- [ ] 实现中文导航、顶部状态、列表分页、Agent标签页、草稿diff、设定库CRUD、上下文隔离沙盒；OpenAPI生成API类型，不在浏览器保存密钥。
- [ ] 运行前端test/build，检查窄屏、键盘焦点、表单错误、保存冲突和加载/空数据状态。
- [ ] 提交 `feat(admin): add agent editor and conversation settings`。

### T13：QQ规则、路由预览与会话页面

**Files:** 新增 apps/admin-web/src/pages/{qq,conversations}/、components/{RoutePreview,MessageTimeline,PermissionEditor}.tsx与测试；新增tests/e2e/qq-routing.spec.ts。

**Interfaces:** 消费T05–T08 API；路由预览和实际运行使用同一后端规则，浏览器不复制一套权限算法。

- [ ] 写用例：群内用户覆盖、私聊白名单、前缀规则、节奏继承来源、未授权会话不能查看、清上下文与删除历史是不同按钮。
- [ ] 运行前端测试，确认缺失页面行为失败。
- [ ] 实现规则表格/编辑、Agent绑定、权限上限、路由解释、三栏历史、trace详情、发送等待状态、按权限导出。
- [ ] 使用模拟API/本地数据库验收分页和身份切换，不通过DOM隐藏泄露他人记录。
- [ ] 提交 `feat(admin): add QQ access rules and conversation history`。

### T14：命令、工具、凭据、审批和审计页面

**Files:** 新增 apps/admin-web/src/pages/{commands,tools,credentials,settings}/；新增tests/e2e/{admin.spec.ts,approvals.spec.ts}；新增Playwright配置和test:e2e script。

**Interfaces:** 消费T07、T09–T11；页面只能选择预装文件资源alias，不能让浏览器提交任意宿主目录。

- [ ] 写端到端目标：新命令绑定到Agent后help出现；替换密钥无回显；上传表情；批准文件diff；Viewer不能审批；Operator不能提升工具权限。
- [ ] 运行 `npm run test:e2e`，确认对应交互尚缺失。
- [ ] 实现命令模板、限5步表单工作流、工具额度、素材库、凭据测试、资源授权、审批及审计筛选；SSE仅推送授权对象状态。
- [ ] 真浏览器验证所有五类后台页面闭环，测试响应/控制台/存储中不出现假密钥明文。
- [ ] 提交 `feat(admin): add tool operations and security administration`。

### T15：导入、备份、保留期和单消费者

**Files:** 新增src/management/cli/{import-env.js,backup.js}、src/management/operations/{status.js,lease.js}、src/platforms/onebot/consumer-lease.js、tests/management/migration.test.js；修改旧agent.js和管理consumer.js。

**Interfaces:** `importLegacyConfig({db,envFile,promptRoot,dryRun}) → 无值摘要`；`backupDatabase({destination})`；`acquireConsumerLease({directory,onCompromised}) → release()`。

- [ ] 测试导入幂等、读取prompt文件、secret加密、白名单保留、用户默认L0、已有配置不被二次导入覆盖；两个消费者不能同时获得租约。
- [ ] 运行 `node --test tests/management/migration.test.js`。
- [ ] 实现dry-run/apply事务与来源哈希、SQLite在线备份、独立key备份要求、保留期任务与TTL导出、共享proper-lockfile租约；失去租约停收停发。
- [ ] 从备份恢复到临时DB验证角色/规则/密钥可解密；缺密钥恢复明确失败；停止旧CLI再启动管理消费者不重复回复。
- [ ] 提交 `feat(management): add legacy migration and operational recovery`。

### T16：Docker部署与迁移文档

**Files:** 新增Dockerfile.management、Dockerfile.management.dockerignore、docs/agent-management-deploy.zh-CN.md；修改compose.qq.yaml、.env.example、.gitignore、README.zh-CN.md。

**Interfaces:** 应用port6080；host绑定127.0.0.1；secrets路径/run/secrets；SQLite/素材独立卷；旧、新运行器共享租约卷；file-tools共享Unix socket卷且network_mode:none。

- [ ] 定义验收脚本：Compose config可解析、构建成功、非root、health可用、关键卷挂载正确、无Docker socket/宿主根挂载、运行镜像无.env和构建工具链。
- [ ] 构建前验证新增镜像/服务不存在对应预期，不能将缺少Docker环境误报为功能测试失败。
- [ ] 实现多阶段npm ci构建与native依赖构建支持，保留原NapCat卷名和profile；file executor仅挂预装资源，所有持久目录准备UID/GID读写权限。
- [ ] 在Ubuntu验收容器启动、关闭/重启、日志脱敏、迁移和回滚；文档清楚标注首次停止无租约旧镜像。
- [ ] 提交 `build: package agent management and migration workflow`。

### T17：综合回归、真实验收准备与完成报告

**Files:** 汇总tests/management、tests/e2e；新增docs/agent-management-acceptance.md，记录真实验证与离线验证的区别。

**Interfaces:** 全部任务契约与现有test:qq；不新增绕过鉴权的测试API到生产。

- [ ] 先运行针对权限/隔离/重置/撤权竞态的集成用例，缺少覆盖项先补失败测试再修复。
- [ ] 执行test:qq、test:management、前端test/build、test:e2e、Linux文件执行器测试及Docker构建。
- [ ] 使用管理台完成“创建两个Agent→动态设定→不同QQ绑定→模拟收发→搜索/表情→文件审批→备份恢复”闭环。
- [ ] 在用户明确指定的真实测试群/好友范围验证QQ效果；没有真实环境时列出未验证项，不能标记真实验收已通过。
- [ ] 检查所有原始需求映射完成、工作树差异可解释、部署/回滚文档一致，再形成完成报告和必要提交。

## 3. 需求追踪

| 用户需求                                 | 实施任务              | 主要验收                                 |
| ---------------------------------------- | --------------------- | ---------------------------------------- |
| Agent CRUD / Prompt / 模型 / API Key加密 | T01–T04、T12          | 版本发布、凭据不可回显、错误模型配置拒绝 |
| 管理特殊命令                             | T07、T14              | help按权限生成、预定义操作执行           |
| QQ群/个人指定Agent、白名单和触发句       | T05、T13              | 访问检查先于路由，前缀触发、作用域覆盖   |
| 对话记录与分级权限                       | T06–T08、T11、T13–T14 | 会话持久隔离、越权拒绝、文件审批         |
| 联网搜索                                 | T09、T14              | 来源真实、限额、不兼容模型有明确降级     |
| 表情包                                   | T10、T14              | 授权素材、场景/频率、图片发送追踪        |
| 新增/添加0–1对话设定                     | T04、T12              | 动态定义无需部署、版本化、0不被忽略      |
| 回复速度配置                             | T04、T08、T12–T13     | 固定/长度等待、上限、reset取消、独立并发 |
| Ubuntu上线与兼容                         | T15–T17               | 单消费者、迁移可重复、原NapCat登录卷保留 |

## 4. 交付约束

执行时每个工作包完成后给出具体已通过测试和剩余项，不能把脚手架或静态页面当成全部需求完成。最终提交不得包含.env、主密钥、会话数据、真实QQ导出或真实模型凭据。

本计划没有开始执行。下一阶段可按T01起顺序实施；需要并行时先明确文件归属及契约，再按用户选择安排。
