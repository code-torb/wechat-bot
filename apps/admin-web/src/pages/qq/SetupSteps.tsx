import { useState } from 'react'
import { Alert, Button, Collapse, Form, Input, InputNumber, Select, Space, Switch, Table, Tag, message } from 'antd'
import { DeleteOutlined, ExportOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import type { AccessRule, Agent, QQBinding, QQGrant, QQSetup } from '../../api/types'

export type QQDraft = Pick<QQSetup, 'defaultAgentId' | 'rules' | 'bindings' | 'grants'>

const scopeLabels: Record<string, string> = { group: '群聊', private: '私聊', group_user: '群内用户' }
const levelNames = ['对话', '联网与表情', '读取文件', '修改文件']
const capabilityOptions = [
  { value: 'search.web', label: 'L1 · 联网搜索' },
  { value: 'meme.send', label: 'L1 · 发送表情包' },
  { value: 'files.list', label: 'L2 · 列出文件' },
  { value: 'files.read', label: 'L2 · 读取文件' },
  { value: 'files.create', label: 'L3 · 创建文件' },
  { value: 'files.update', label: 'L3 · 修改文件' },
]

const agentLink = (agent: Agent) => (
  <Link to={`/agents/${agent.id}`} target="_blank" rel="noopener noreferrer" className="qq-agent-link">
    查看详情 <ExportOutlined />
  </Link>
)

export function AgentStep({ agents, selected, onSelect }: {
  agents: Agent[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const available = agents.filter((agent) => agent.status === 'active' && agent.publishedVersionId)
  return (
    <section className="qq-stage-card">
      <div className="qq-stage-heading">
        <div><span className="qq-eyebrow">步骤 02 / 04</span><h3>选择默认 Agent</h3></div>
        <p>这个 Agent 负责没有单独绑定的群聊和私聊。选择只修改本次草稿，最后一步才会生效。</p>
      </div>
      {available.length ? (
        <div className="qq-agent-grid">
          {available.map((agent) => (
            <div key={agent.id} className={`qq-agent-card ${selected === agent.id ? 'is-selected' : ''}`}>
              <div className="qq-agent-card-top">
                <span className="qq-agent-monogram">{agent.name.trim().slice(0, 1)}</span>
                <Tag color={selected === agent.id ? 'processing' : 'success'}>{selected === agent.id ? '已选择' : '已发布'}</Tag>
              </div>
              <h4>{agent.name}</h4>
              <p>{agent.description || '暂无描述，可在 Agent 详情中补充角色说明。'}</p>
              <div className="qq-agent-card-footer">
                <span>草稿模型：{agent.draft?.model?.name || '未填写'}</span>
                {agentLink(agent)}
              </div>
              <Button type={selected === agent.id ? 'primary' : 'default'} aria-pressed={selected === agent.id} onClick={() => onSelect(agent.id)}>
                {selected === agent.id ? '当前选择' : '选择此 Agent'}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <Alert type="info" showIcon message="还没有可用的 Agent" description="先在 Agent 详情中配置模型与 Prompt，发布并启用后再返回选择。" />
      )}
    </section>
  )
}

type RuleForm = {
  scopeType: 'group' | 'private'
  scopeKey: string
  allow: boolean
  mode: 'any' | 'all'
  mention: boolean
  prefix?: string
  phrase?: string
  maxLevel: number
  quoteReply: boolean
}
type BindingForm = { scopeType: QQBinding['scopeType']; scopeKey: string; agentId: string }
type GrantForm = QQGrant

export function PermissionsStep({ draft, onChange, agents }: {
  draft: QQDraft
  onChange: (draft: QQDraft) => void
  agents: Agent[]
}) {
  const [ruleForm] = Form.useForm<RuleForm>()
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const availableAgents = agents.filter((agent) => agent.status === 'active' && agent.publishedVersionId)
  const update = (part: Partial<QQDraft>) => onChange({ ...draft, ...part })
  const editRule = (rule: AccessRule) => {
    setEditingRule(`${rule.scopeType}:${rule.scopeKey}`)
    ruleForm.setFieldsValue({
      scopeType: rule.scopeType === 'private' ? 'private' : 'group',
      scopeKey: rule.scopeKey,
      allow: rule.allow,
      mode: rule.trigger?.mode || 'any',
      mention: Boolean(rule.trigger?.mention),
      prefix: rule.trigger?.prefix || '',
      phrase: rule.trigger?.phrase || '',
      maxLevel: rule.maxLevel,
      quoteReply: rule.quoteReply,
    })
  }
  return (
    <div className="qq-permissions-stack">
      <section className="qq-stage-card">
        <div className="qq-stage-heading">
          <div><span className="qq-eyebrow">步骤 03 / 04</span><h3>设置白名单与触发方式</h3></div>
          <p>只有白名单中的群或好友能触发对话。群聊可以使用 @机器人、前缀或完整语句，并设置任一或全部命中；私聊只接受好友消息。</p>
        </div>
        <Table<AccessRule>
          rowKey="id" size="small" pagination={false} dataSource={draft.rules} scroll={{ x: 680 }}
          locale={{ emptyText: '尚未添加白名单，机器人不会回复任何消息。' }}
          columns={[
            { title: '场景', dataIndex: 'scopeType', render: (value: string) => scopeLabels[value] || value },
            { title: '群号 / QQ 号', dataIndex: 'scopeKey' },
            { title: '状态', dataIndex: 'allow', render: (value: boolean) => <Tag color={value ? 'success' : 'default'}>{value ? '允许' : '拒绝'}</Tag> },
            { title: '触发', render: (_, row) => row.scopeType === 'group'
              ? `${row.trigger?.mode === 'all' ? '全部：' : '任一：'}${[row.trigger?.mention && '@机器人', row.trigger?.prefix, row.trigger?.phrase].filter(Boolean).join(' / ') || '未设置'}`
              : '好友消息' },
            { title: '权限上限', dataIndex: 'maxLevel', render: (value: number) => `L${value} · ${levelNames[value]}` },
            { title: '操作', render: (_, row) => <Space>
              {row.scopeType !== 'group_user' && <Button type="link" onClick={() => editRule(row)}>编辑</Button>}
              <Button type="text" danger icon={<DeleteOutlined />} aria-label={`移除 ${row.scopeKey} 的白名单`} onClick={() => {
                update({ rules: draft.rules.filter((item) => item.id !== row.id) })
                if (editingRule === `${row.scopeType}:${row.scopeKey}`) { setEditingRule(null); ruleForm.resetFields() }
              }} />
            </Space> },
          ]}
        />
        <Form<RuleForm>
          form={ruleForm}
          layout="inline" className="qq-form"
          onFinish={(values) => {
            const key = values.scopeKey.trim()
            if (values.scopeType === 'group' && values.allow && !values.mention && !values.prefix?.trim() && !values.phrase?.trim()) {
              message.error('群聊至少选择一种触发方式')
              return
            }
            const original = draft.rules.find((row) => `${row.scopeType}:${row.scopeKey}` === editingRule)
            const next: AccessRule = {
              id: `${values.scopeType}:${key}`, scopeType: values.scopeType, scopeKey: key,
              allow: values.allow, trigger: { mode: values.mode, mention: values.mention, prefix: values.prefix?.trim() || null, phrase: values.phrase?.trim() || null },
              maxLevel: values.maxLevel, pacingOverride: original?.pacingOverride || null, quoteReply: values.quoteReply,
            }
            update({ rules: [...draft.rules.filter((row) =>
              `${row.scopeType}:${row.scopeKey}` !== editingRule &&
              !(row.scopeType === values.scopeType && row.scopeKey === key)), next] })
            setEditingRule(null)
            ruleForm.resetFields()
            message.success('白名单已更新到草稿')
          }}
        >
          <Form.Item name="scopeType" initialValue="group" label="场景"><Select style={{ width: 96 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]} /></Form.Item>
          <Form.Item name="scopeKey" rules={[{ required: true, message: '填写群号或 QQ 号' }, { pattern: /^\d+$/, message: '只能填写数字' }]}><Input placeholder="群号 / QQ 号" /></Form.Item>
          <Form.Item name="allow" label="允许" valuePropName="checked" initialValue={true}><Switch size="small" /></Form.Item>
          <Form.Item name="mode" label="命中" initialValue="any"><Select style={{ width: 104 }} options={[{ value: 'any', label: '任一触发' }, { value: 'all', label: '全部触发' }]} /></Form.Item>
          <Form.Item name="mention" label="@触发" valuePropName="checked" initialValue={true}><Switch size="small" /></Form.Item>
          <Form.Item name="prefix"><Input placeholder="前缀（可选）" /></Form.Item>
          <Form.Item name="phrase"><Input placeholder="完整语句（可选）" /></Form.Item>
          <Form.Item name="maxLevel" label="上限" initialValue={0}><InputNumber min={0} max={3} style={{ width: 70 }} /></Form.Item>
          <Form.Item name="quoteReply" label="引用原消息" valuePropName="checked" initialValue={false}><Switch size="small" /></Form.Item>
          <Button htmlType="submit">{editingRule ? '更新草稿' : '加入草稿'}</Button>
          {editingRule && <Button onClick={() => { setEditingRule(null); ruleForm.resetFields() }}>取消编辑</Button>}
        </Form>
      </section>

      <section className="qq-stage-card">
        <div className="qq-stage-heading">
          <div><span className="qq-eyebrow">权限说明</span><h3>L0–L3 具体能做什么</h3></div>
          <p>白名单的级别只是能力上限。L1 以上仍需 Agent 启用对应能力，并向指定发言者授权；文件操作还需 Agent 的资源授权。</p>
        </div>
        <div className="qq-level-grid">
          <div><b>L0</b><strong>仅对话</strong><span>回复群聊 @ 与白名单好友，不调用搜索或文件工具。</span></div>
          <div><b>L1</b><strong>联网与表情</strong><span>在 L0 基础上，可授权联网搜索、发送表情包。</span></div>
          <div><b>L2</b><strong>读取文件</strong><span>在 L1 基础上，可授权列出和读取已登记的文件资源。</span></div>
          <div><b>L3</b><strong>修改文件</strong><span>在 L2 基础上，可授权创建和修改白名单资源；写入仍遵守审批规则。</span></div>
        </div>
      </section>

      <section className="qq-stage-card">
        <div className="qq-stage-heading">
          <div><span className="qq-eyebrow">按需覆盖</span><h3>群或好友单独指定 Agent</h3></div>
          <p>未单独绑定时使用上一步的默认 Agent。群内用户优先于群聊绑定，格式为“群号:QQ号”。</p>
        </div>
        <Table<QQBinding>
          rowKey={(row) => `${row.scopeType}:${row.scopeKey}`} size="small" pagination={false} dataSource={draft.bindings}
          locale={{ emptyText: '目前全部使用默认 Agent。' }}
          columns={[
            { title: '场景', dataIndex: 'scopeType', render: (value: string) => scopeLabels[value] || value },
            { title: '作用范围', dataIndex: 'scopeKey' },
            { title: 'Agent', dataIndex: 'agentId', render: (id: string) => agents.find((agent) => agent.id === id)?.name || id },
            { title: '操作', render: (_, row) => <Button type="text" danger icon={<DeleteOutlined />} aria-label={`移除 ${row.scopeKey} 的绑定`} onClick={() => update({ bindings: draft.bindings.filter((item) => item !== row) })} /> },
          ]}
        />
        <Form<BindingForm>
          layout="inline" className="qq-form"
          onFinish={(values) => {
            const scopeKey = values.scopeKey.trim()
            const valid = values.scopeType === 'group_user' ? /^\d+:\d+$/.test(scopeKey) : /^\d+$/.test(scopeKey)
            if (!valid) { message.error('作用范围格式不正确'); return }
            update({ bindings: [...draft.bindings.filter((item) => !(item.scopeType === values.scopeType && item.scopeKey === scopeKey)), { ...values, scopeKey }] })
            message.success('Agent 绑定已加入草稿')
          }}
        >
          <Form.Item name="scopeType" initialValue="group" label="场景"><Select style={{ width: 112 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }, { value: 'group_user', label: '群内用户' }]} /></Form.Item>
          <Form.Item name="scopeKey" rules={[{ required: true, message: '填写群号、QQ 号或群号:QQ号' }]}><Input placeholder="群号 / QQ号 / 群号:QQ号" style={{ width: 240 }} /></Form.Item>
          <Form.Item name="agentId" rules={[{ required: true, message: '选择 Agent' }]}>
            <Select placeholder="选择 Agent" style={{ width: 190 }} options={availableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} />
          </Form.Item>
          <Button htmlType="submit">加入绑定</Button>
        </Form>
      </section>

      <section className="qq-stage-card">
        <div className="qq-stage-heading">
          <div><span className="qq-eyebrow">高级权限</span><h3>向指定发言者授权工具</h3></div>
          <p>群聊需要填写群号和发言者 QQ；私聊两项都填好友 QQ。授权只有在白名单级别、Agent 能力和资源授权都满足时才生效。</p>
        </div>
        <Table<QQGrant>
          rowKey={(row) => `${row.scene}:${row.peerId}:${row.senderId}:${row.capability}:${row.resourceId}`} size="small" pagination={false} dataSource={draft.grants} scroll={{ x: 640 }}
          locale={{ emptyText: '尚未授权额外工具；L0 对话仍可正常使用。' }}
          columns={[
            { title: '场景', dataIndex: 'scene', render: (value: string) => scopeLabels[value] },
            { title: '群 / 好友', dataIndex: 'peerId' },
            { title: '发言者 QQ', dataIndex: 'senderId' },
            { title: '能力', dataIndex: 'capability', render: (value: string) => capabilityOptions.find((item) => item.value === value)?.label || value },
            { title: '资源 ID', dataIndex: 'resourceId', render: (value: string) => value || '—' },
            { title: '操作', render: (_, row) => <Button type="text" danger icon={<DeleteOutlined />} aria-label={`移除 ${row.senderId} 的 ${row.capability} 授权`} onClick={() => update({ grants: draft.grants.filter((item) => item !== row) })} /> },
          ]}
        />
        <Form<GrantForm>
          layout="inline" className="qq-form"
          onFinish={(values) => {
            const grant = { ...values, peerId: values.peerId.trim(), senderId: values.senderId.trim(), resourceId: values.resourceId?.trim() || '' }
            if (!/^\d+$/.test(grant.peerId) || !/^\d+$/.test(grant.senderId) ||
                grant.scene === 'private' && grant.peerId !== grant.senderId ||
                grant.capability.startsWith('files.') && !grant.resourceId) {
              message.error('检查群号、发言者 QQ；文件能力还需填写资源 ID')
              return
            }
            const key = (item: QQGrant) => `${item.scene}:${item.peerId}:${item.senderId}:${item.capability}:${item.resourceId}`
            update({ grants: [...draft.grants.filter((item) => key(item) !== key(grant)), grant] })
            message.success('工具授权已加入草稿')
          }}
        >
          <Form.Item name="scene" initialValue="group" label="场景"><Select style={{ width: 96 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]} /></Form.Item>
          <Form.Item name="peerId" rules={[{ required: true }]}><Input placeholder="群号 / 好友 QQ" /></Form.Item>
          <Form.Item name="senderId" rules={[{ required: true }]}><Input placeholder="发言者 QQ" /></Form.Item>
          <Form.Item name="capability" rules={[{ required: true }]}><Select placeholder="选择能力" style={{ width: 190 }} options={capabilityOptions} /></Form.Item>
          <Form.Item name="resourceId"><Input placeholder="文件资源 ID（文件能力必填）" style={{ width: 220 }} /></Form.Item>
          <Button htmlType="submit">加入授权</Button>
        </Form>
      </section>
    </div>
  )
}

type Preview = { accepted: boolean; reason: string; agentId: string | null; maxLevel: number | null }
const reasonLabels: Record<string, string> = {
  ok: '允许回复', not_allowlisted: '未进入白名单', trigger_not_matched: '未命中群聊触发词',
  no_agent_bound: '没有绑定 Agent', agent_unavailable: 'Agent 未启用',
  agent_not_published: 'Agent 未发布', private_not_friend: '仅支持 QQ 好友私聊',
  bot_account_disabled: 'QQ 帐号未启用',
}

export function ReviewStep({ setup, agents, nickname, online, draftMode = false }: {
  setup: QQSetup
  agents: Agent[]
  nickname: string
  online: boolean
  draftMode?: boolean
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const selected = agents.find((agent) => agent.id === setup.defaultAgentId)
  return (
    <div className="qq-permissions-stack">
      <section className="qq-stage-card">
        <div className="qq-stage-heading">
          <div><span className="qq-eyebrow">{draftMode ? '步骤 04 / 04 · 待提交' : 'QQ 帐号 · 已保存'}</span>
            <h3>{draftMode ? '提交前核对帐号与 Agent' : '帐号与 Agent 已绑定'}</h3></div>
          <p>{draftMode
            ? '以下是本次草稿，将在点击“Submit · 提交配置”后一次性保存。可返回前面步骤继续修改。'
            : '这是服务器当前保存的配置。可在帐号列表中点击“编辑配置”修改。'}</p>
        </div>
        <div className="qq-review-identity">
          <span className="qq-account-avatar">{(nickname || setup.selfId).slice(0, 1)}</span>
          <div><strong>{nickname || `QQ ${setup.selfId}`}</strong><span>QQ 号 {setup.selfId} · {online ? 'NapCat 在线' : '目前未在线'}</span></div>
        </div>
        <div className="qq-review-agent">
          <span>默认 Agent</span>
          {selected ? <><strong>{selected.name}</strong>{agentLink(selected)}</> : <strong>{setup.defaultAgentId || '未配置'}</strong>}
        </div>
        <div className="qq-review-stats">
          <span><b>{setup.rules.filter((rule) => rule.allow).length}</b> 个允许的白名单</span>
          <span><b>{setup.bindings.length}</b> 个单独绑定</span>
          <span><b>{setup.grants.length}</b> 项工具授权</span>
        </div>
        <Table<AccessRule>
          rowKey="id" size="small" pagination={false} dataSource={setup.rules} scroll={{ x: 650 }}
          columns={[
            { title: '场景', dataIndex: 'scopeType', render: (value: string) => scopeLabels[value] || value },
            { title: '群号 / QQ 号', dataIndex: 'scopeKey' },
            { title: '状态', dataIndex: 'allow', render: (value: boolean) => value ? '允许' : '拒绝' },
            { title: '触发', render: (_, row) => row.scopeType === 'group'
              ? `${row.trigger?.mode === 'all' ? '全部' : '任一'}：${[row.trigger?.mention && '@机器人', row.trigger?.prefix, row.trigger?.phrase].filter(Boolean).join(' / ') || '未设置'}`
              : '好友消息' },
            { title: 'Agent', render: (_, row) => {
              const binding = setup.bindings.find((item) => item.scopeType === row.scopeType && item.scopeKey === row.scopeKey)
              const agent = agents.find((item) => item.id === (binding?.agentId || setup.defaultAgentId))
              return agent ? <Space>{agent.name}{agentLink(agent)}</Space> : '未绑定'
            } },
            { title: '权限上限', dataIndex: 'maxLevel', render: (value: number) => `L${value} · ${levelNames[value]}` },
          ]}
        />
        {setup.bindings.some((item) => item.scopeType === 'group_user') && <p className="muted">群内用户的单独绑定优先于上表展示的群聊 Agent。</p>}
        <Collapse className="qq-review-details" items={[{
          key: 'details',
          label: '查看单独绑定与工具授权详情',
          children: (
            <div className="qq-review-detail-tables">
              <h4>单独绑定的 Agent</h4>
              <Table<QQBinding>
                rowKey={(row) => `${row.scopeType}:${row.scopeKey}`} size="small" pagination={false} dataSource={setup.bindings}
                locale={{ emptyText: '没有单独绑定，所有白名单使用默认 Agent。' }}
                columns={[
                  { title: '场景', dataIndex: 'scopeType', render: (value: string) => scopeLabels[value] || value },
                  { title: '群号 / QQ 号', dataIndex: 'scopeKey' },
                  { title: 'Agent', dataIndex: 'agentId', render: (id: string) => {
                    const agent = agents.find((item) => item.id === id)
                    return agent ? <Space>{agent.name}{agentLink(agent)}</Space> : id
                  } },
                ]}
              />
              <h4>发言者工具授权</h4>
              <Table<QQGrant>
                rowKey={(row) => `${row.scene}:${row.peerId}:${row.senderId}:${row.capability}:${row.resourceId}`}
                size="small" pagination={false} dataSource={setup.grants} scroll={{ x: 650 }}
                locale={{ emptyText: '未授予额外工具。' }}
                columns={[
                  { title: '场景', dataIndex: 'scene', render: (value: string) => scopeLabels[value] || value },
                  { title: '群 / 好友', dataIndex: 'peerId' },
                  { title: '发言者 QQ', dataIndex: 'senderId' },
                  { title: '能力', dataIndex: 'capability', render: (value: string) => capabilityOptions.find((item) => item.value === value)?.label || value },
                  { title: '文件资源 ID', dataIndex: 'resourceId', render: (value: string) => value || '—' },
                ]}
              />
            </div>
          ),
        }]} />
      </section>
      {!draftMode && <section className="qq-stage-card">
        <div className="qq-stage-heading">
          <div><span className="qq-eyebrow">路由预览</span><h3>用一条示例消息检查配置</h3></div>
          <p>此处只计算白名单、触发词、Agent 和权限上限，不会向 QQ 发送消息或调用模型。</p>
        </div>
        <Form
          layout="inline" className="qq-form"
          onFinish={async (values) => {
            try {
              const result = await api<Preview>(`/api/v1/qq/accounts/${setup.accountId}/route-preview`, {
                method: 'POST', body: { ...values, mentionedSelf: values.mentionedSelf === 'true' },
              })
              setPreview(result.data)
            } catch (error) {
              message.error(error instanceof Error ? error.message : '预览失败')
            }
          }}
        >
          <Form.Item name="scene" initialValue="group"><Select style={{ width: 95 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]} /></Form.Item>
          <Form.Item name="peerId" rules={[{ required: true }]}><Input placeholder="群号 / 好友 QQ" /></Form.Item>
          <Form.Item name="senderId" rules={[{ required: true }]}><Input placeholder="发言者 QQ" /></Form.Item>
          <Form.Item name="text" rules={[{ required: true }]}><Input placeholder="消息内容" /></Form.Item>
          <Form.Item name="mentionedSelf" initialValue="true"><Select style={{ width: 96 }} options={[{ value: 'true', label: '已 @' }, { value: 'false', label: '未 @' }]} /></Form.Item>
          <Button htmlType="submit">查看路由</Button>
        </Form>
        {preview && <Alert
          type={preview.accepted ? 'success' : 'warning'} showIcon
          message={reasonLabels[preview.reason] || preview.reason}
          description={preview.accepted && preview.agentId ? (
            <Space>
              <span>命中 Agent：{agents.find((item) => item.id === preview.agentId)?.name || preview.agentId}</span>
              {agents.find((item) => item.id === preview.agentId) && agentLink(agents.find((item) => item.id === preview.agentId)!)}
              <span>权限上限：L{preview.maxLevel}</span>
            </Space>
          ) : '请检查白名单、触发方式或 Agent 状态。'}
        />}
      </section>}
    </div>
  )
}
