import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, InputNumber, Select, Space, Spin, Switch, Table, Tag, message } from 'antd'
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { api, ApiError } from '../api/client'
import type { AccessRule, Agent, Binding, QQAccount, QQLoginStatus } from '../api/types'

type Preview = { accepted: boolean; reason: string; agentId?: string | null; maxLevel?: number | null }
type RuleForm = {
  scopeType: 'group' | 'private'
  scopeKey: string
  allow: boolean
  mention: boolean
  prefix?: string
  phrase?: string
  maxLevel: number
  quoteReply: boolean
}
type BindingForm = { scopeType: 'group' | 'private' | 'group_user'; scopeKey: string; agentId: string }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败'

export default function QQPage() {
  const queryClient = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const lastActiveId = useRef<string | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<Agent[]>('/api/v1/agents').then((result) => result.data),
  })
  const { data: accounts } = useQuery({
    queryKey: ['qq-accounts'],
    queryFn: () => api<QQAccount[]>('/api/v1/qq/accounts').then((result) => result.data),
  })
  const login = useQuery({
    queryKey: ['qq-login'],
    queryFn: () => api<QQLoginStatus>('/api/v1/qq/login').then((result) => result.data),
    refetchInterval: (query) => query.state.error ? false : 5000,
    retry: false,
  })
  const activeId = login.data?.accountId
  useEffect(() => {
    if (activeId && lastActiveId.current !== activeId) setAccountId(activeId)
    else if (!accountId && accounts?.length) setAccountId(accounts[0].id)
    lastActiveId.current = activeId || null
  }, [activeId, accountId, accounts])
  useEffect(() => {
    if (activeId) queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
  }, [activeId, queryClient])
  const account = accounts?.find((item) => item.id === accountId)
  const availableAgents = (agents || []).filter((agent) => agent.status === 'active' && agent.publishedVersionId)
  const { data: rules } = useQuery({
    queryKey: ['qq-rules', accountId],
    queryFn: () => api<AccessRule[]>(`/api/v1/qq/accounts/${accountId}/access-rules`).then((result) => result.data),
    enabled: Boolean(accountId),
  })
  const { data: bindings } = useQuery({
    queryKey: ['qq-bindings', accountId],
    queryFn: () => api<Binding[]>(`/api/v1/qq/accounts/${accountId}/bindings`).then((result) => result.data),
    enabled: Boolean(accountId),
  })
  const refreshQr = useMutation({
    mutationFn: () => api('/api/v1/qq/login/refresh', { method: 'POST' }),
    onSuccess: () => login.refetch(),
    onError: (error) => message.error(errorMessage(error)),
  })
  const verifyTotp = useMutation({
    mutationFn: () => api('/api/v1/qq/login/verify', { method: 'POST', body: { totpCode } }),
    onSuccess: () => { setTotpCode(''); login.refetch() },
    onError: (error) => message.error(errorMessage(error)),
  })
  const setDefaultAgent = useMutation({
    mutationFn: (defaultAgentId: string | null) =>
      api(`/api/v1/qq/accounts/${accountId}`, { method: 'PATCH', body: { defaultAgentId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
      message.success('默认 Agent 已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const saveRules = useMutation({
    mutationFn: (next: AccessRule[]) =>
      api(`/api/v1/qq/accounts/${accountId}/access-rules`, {
        method: 'PUT',
        body: {
          rules: next.map(({ scopeType, scopeKey, allow, trigger, maxLevel, pacingOverride, quoteReply }) => ({
            scopeType, scopeKey, allow, trigger, maxLevel, pacingOverride, quoteReply,
          })),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qq-rules', accountId] })
      message.success('白名单已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const saveBindings = useMutation({
    mutationFn: (next: { scopeType: string; scopeKey: string; agentId: string }[]) =>
      api(`/api/v1/qq/accounts/${accountId}/bindings`, { method: 'PUT', body: { bindings: next } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qq-bindings', accountId] })
      message.success('Agent 绑定已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const loginError = login.error instanceof ApiError ? login.error : null

  return (
    <div className="page qq-page">
      <h2>QQ 接入与权限</h2>
      <div className="qq-layout">
        <section className="qq-login-panel">
          <div className="qq-section-title">
            <h3>QQ 登录</h3>
            <Button icon={<ReloadOutlined />} title="刷新登录状态" onClick={() => login.refetch()} loading={login.isFetching} />
          </div>
          {loginError?.code === 'NAPCAT_TOTP_REQUIRED' ? (
            <Space.Compact style={{ width: '100%' }}>
              <Input value={totpCode} maxLength={6} placeholder="WebUI 动态验证码" onChange={(event) => setTotpCode(event.target.value)} />
              <Button type="primary" disabled={!/^\d{6}$/.test(totpCode)} loading={verifyTotp.isPending} onClick={() => verifyTotp.mutate()}>
                验证
              </Button>
            </Space.Compact>
          ) : loginError ? (
            <Alert type="error" showIcon message={loginError.message} />
          ) : login.isLoading ? (
            <Spin />
          ) : login.data?.isLogin ? (
            <div className="qq-login-state">
              <Tag color={login.data.oneBotReady ? 'success' : 'warning'}>
                {login.data.oneBotReady ? '已连接' : 'QQ 已登录，等待消息连接'}
              </Tag>
              <strong>{login.data.selfId || '正在识别 QQ 号'}</strong>
              {login.data.isOffline && <Alert type="warning" showIcon message="QQ 当前离线，请检查 NapCat 登录状态" />}
            </div>
          ) : (
            <div className="qq-qr-state">
              {login.data?.qrcodeUrl ? (
                <div className="qq-qr"><QRCodeSVG value={login.data.qrcodeUrl} size={192} level="M" /></div>
              ) : (
                <Alert type="info" showIcon message={login.data?.loginError || '等待 NapCat 生成登录二维码'} />
              )}
              <Button icon={<ReloadOutlined />} loading={refreshQr.isPending} onClick={() => refreshQr.mutate()}>
                刷新二维码
              </Button>
            </div>
          )}
        </section>
        <section className="qq-account-panel">
          <h3>帐号与默认 Agent</h3>
          <div className="qq-account-fields">
            <label>
              QQ 帐号
              <Select
                value={accountId || undefined}
                placeholder="登录 QQ 后选择帐号"
                onChange={setAccountId}
                options={(accounts || []).map((item) => ({ value: item.id, label: `${item.selfId}${item.id === activeId ? ' · 当前在线' : ''}` }))}
              />
            </label>
            <label>
              默认 Agent
              <Select
                value={account?.defaultAgentId || undefined}
                placeholder="选择已发布的 Agent"
                disabled={!accountId || setDefaultAgent.isPending}
                allowClear
                onChange={(value) => setDefaultAgent.mutate(value || null)}
                options={availableAgents.map((agent) => ({ value: agent.id, label: agent.name }))}
              />
            </label>
          </div>
          {account && <p className="muted">群或私聊可以单独绑定 Agent；没有单独绑定时使用默认 Agent。</p>}
        </section>
      </div>
      {accountId && (
        <>
          <section className="qq-settings-section">
            <h3>群聊与私聊白名单</h3>
            <Table<AccessRule>
              rowKey="id"
              dataSource={rules || []}
              pagination={false}
              size="small"
              scroll={{ x: 600 }}
              columns={[
                { title: '场景', dataIndex: 'scopeType', render: (value: string) => ({ group: '群聊', private: '私聊', group_user: '群内用户' })[value] || value },
                { title: '群号 / QQ 号', dataIndex: 'scopeKey' },
                { title: '状态', dataIndex: 'allow', render: (value: boolean) => <Tag color={value ? 'success' : 'default'}>{value ? '允许' : '拒绝'}</Tag> },
                { title: '触发', render: (_, row) => row.scopeType === 'group' ? [row.trigger?.mention && '@机器人', row.trigger?.prefix, row.trigger?.phrase].filter(Boolean).join(' / ') || '未设置' : '私聊消息' },
                { title: '权限上限', dataIndex: 'maxLevel', render: (value: number) => `L${value}` },
                {
                  title: '操作',
                  render: (_, row) => (
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      title="移除白名单规则"
                      disabled={saveRules.isPending}
                      onClick={() => saveRules.mutate((rules || []).filter((item) => item.id !== row.id))}
                    />
                  ),
                },
              ]}
            />
            <Form<RuleForm>
              layout="inline"
              className="qq-form"
              onFinish={(values) => {
                if (values.scopeType === 'group' && !values.mention && !values.prefix?.trim() && !values.phrase?.trim()) {
                  message.error('群聊至少选择一种触发方式')
                  return
                }
                const next = [...(rules || []).filter((rule) => !(rule.scopeType === values.scopeType && rule.scopeKey === values.scopeKey))]
                next.push({
                  id: `${values.scopeType}:${values.scopeKey}`,
                  scopeType: values.scopeType,
                  scopeKey: values.scopeKey.trim(),
                  allow: values.allow,
                  trigger: { mode: 'any', mention: values.mention, prefix: values.prefix?.trim() || null, phrase: values.phrase?.trim() || null },
                  maxLevel: values.maxLevel,
                  pacingOverride: null,
                  quoteReply: values.quoteReply,
                })
                saveRules.mutate(next)
              }}
            >
              <Form.Item name="scopeType" initialValue="group"><Select style={{ width: 96 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]} /></Form.Item>
              <Form.Item name="scopeKey" rules={[{ required: true, message: '填写群号或 QQ 号' }, { pattern: /^\d+$/, message: '只能填写数字' }]}><Input placeholder="群号 / QQ 号" /></Form.Item>
              <Form.Item name="allow" label="允许" valuePropName="checked" initialValue={true}><Switch size="small" /></Form.Item>
              <Form.Item name="mention" label="@触发" valuePropName="checked" initialValue={true}><Switch size="small" /></Form.Item>
              <Form.Item name="prefix"><Input placeholder="前缀（可选）" /></Form.Item>
              <Form.Item name="phrase"><Input placeholder="完整语句（可选）" /></Form.Item>
              <Form.Item name="maxLevel" label="权限" initialValue={0}><InputNumber min={0} max={3} style={{ width: 64 }} /></Form.Item>
              <Form.Item name="quoteReply" label="引用" valuePropName="checked" initialValue={false}><Switch size="small" /></Form.Item>
              <Button type="primary" htmlType="submit" loading={saveRules.isPending}>保存白名单</Button>
            </Form>
          </section>
          <section className="qq-settings-section">
            <h3>单独绑定 Agent</h3>
            <Table<Binding>
              rowKey="id"
              dataSource={bindings || []}
              pagination={false}
              size="small"
              scroll={{ x: 500 }}
              columns={[
                { title: '场景', dataIndex: 'scope_type', render: (value: string) => ({ group: '群聊', private: '私聊', group_user: '群内用户' })[value] || value },
                { title: '群号 / QQ 号', dataIndex: 'scope_key' },
                { title: 'Agent', dataIndex: 'agent_id', render: (value: string) => agents?.find((agent) => agent.id === value)?.name || value },
                {
                  title: '操作',
                  render: (_, row) => (
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      title="移除单独绑定"
                      disabled={saveBindings.isPending}
                      onClick={() => saveBindings.mutate((bindings || []).filter((item) => item.id !== row.id).map((item) => ({ scopeType: item.scope_type, scopeKey: item.scope_key, agentId: item.agent_id })))}
                    />
                  ),
                },
              ]}
            />
            <Form<BindingForm>
              layout="inline"
              className="qq-form"
              onFinish={(values) => {
                const next = (bindings || [])
                  .filter((item) => !(item.scope_type === values.scopeType && item.scope_key === values.scopeKey))
                  .map((item) => ({ scopeType: item.scope_type, scopeKey: item.scope_key, agentId: item.agent_id }))
                saveBindings.mutate([...next, { ...values, scopeKey: values.scopeKey.trim() }])
              }}
            >
              <Form.Item name="scopeType" initialValue="group"><Select style={{ width: 116 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }, { value: 'group_user', label: '群内用户' }]} /></Form.Item>
              <Form.Item name="scopeKey" rules={[{ required: true, message: '填写群号或 QQ 号' }]}><Input placeholder="群号 / QQ 号；群内用户用 群号:QQ号" style={{ width: 260 }} /></Form.Item>
              <Form.Item name="agentId" rules={[{ required: true, message: '选择 Agent' }]}>
                <Select placeholder="选择 Agent" style={{ width: 180 }} options={availableAgents.map((agent) => ({ value: agent.id, label: agent.name }))} />
              </Form.Item>
              <Button htmlType="submit" loading={saveBindings.isPending}>保存绑定</Button>
            </Form>
          </section>
          <section className="qq-settings-section">
            <h3>路由预览</h3>
            <Form
              layout="inline"
              className="qq-form"
              onFinish={async (values) => {
                try {
                  const result = await api<Preview>(`/api/v1/qq/accounts/${accountId}/route-preview`, {
                    method: 'POST',
                    body: { ...values, mentionedSelf: values.mentionedSelf === 'true' },
                  })
                  setPreview(result.data)
                } catch (error) {
                  message.error(errorMessage(error))
                }
              }}
            >
              <Form.Item name="scene" initialValue="group"><Select style={{ width: 100 }} options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]} /></Form.Item>
              <Form.Item name="peerId" rules={[{ required: true }]}><Input placeholder="群号 / QQ 号" /></Form.Item>
              <Form.Item name="senderId" rules={[{ required: true }]}><Input placeholder="发言人 QQ" /></Form.Item>
              <Form.Item name="text" rules={[{ required: true }]}><Input placeholder="消息内容" /></Form.Item>
              <Form.Item name="mentionedSelf" initialValue="true"><Select style={{ width: 100 }} options={[{ value: 'true', label: '已 @' }, { value: 'false', label: '未 @' }]} /></Form.Item>
              <Button htmlType="submit">预览</Button>
            </Form>
            {preview && <Alert type={preview.accepted ? 'success' : 'warning'} showIcon message={`${preview.accepted ? '允许' : '拒绝'}：${preview.reason}${preview.agentId ? `，Agent ${agents?.find((agent) => agent.id === preview.agentId)?.name || preview.agentId}` : ''}${preview.maxLevel != null ? `，权限上限 L${preview.maxLevel}` : ''}`} />}
          </section>
        </>
      )}
    </div>
  )
}
