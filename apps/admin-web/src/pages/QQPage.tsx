import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Input, Select, Space, Spin, Tag, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { api, ApiError } from '../api/client'
import type { Agent, QQAccount, QQConnection, QQLoginStatus, QQSetup } from '../api/types'
import { AgentStep, PermissionsStep, ReviewStep, type QQDraft } from './qq/SetupSteps'

const stages = ['QQ 帐号', '选择 Agent', '白名单与权限', '配置结果']
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败'
const toDraft = (setup: QQSetup): QQDraft => ({
  defaultAgentId: setup.defaultAgentId,
  rules: setup.rules,
  bindings: setup.bindings,
  grants: setup.grants,
})

export default function QQPage() {
  const queryClient = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const [step, setStep] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, QQDraft>>({})
  const [totpCode, setTotpCode] = useState('')
  const lastActiveId = useRef<string | null>(null)
  const selectedAccountId = useRef(accountId)
  selectedAccountId.current = accountId

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<Agent[]>('/api/v1/agents').then((result) => result.data),
  })
  const { data: accounts = [] } = useQuery({
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
  const chooseAccount = (id: string) => {
    if (id === accountId) return
    setAccountId(id)
    setStep(0)
  }
  useEffect(() => {
    if (activeId && lastActiveId.current !== activeId) chooseAccount(activeId)
    else if (!accountId && accounts.length) chooseAccount(accounts[0].id)
    lastActiveId.current = activeId || null
  }, [activeId, accountId, accounts])
  useEffect(() => {
    if (activeId) queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
  }, [activeId, queryClient])

  const setup = useQuery({
    queryKey: ['qq-setup', accountId],
    queryFn: () => api<QQSetup>(`/api/v1/qq/accounts/${accountId}/setup`).then((result) => result.data),
    enabled: Boolean(accountId),
    retry: false,
  })
  const draft = drafts[accountId] ?? (setup.data ? toDraft(setup.data) : null)
  const setCurrentDraft = (changes: QQDraft) => setDrafts((current) => ({ ...current, [accountId]: changes }))
  const connection = useQuery({
    queryKey: ['qq-connection'],
    queryFn: () => api<QQConnection>('/api/v1/qq/connection').then((result) => result.data),
    enabled: Boolean(login.data?.isLogin),
    retry: false,
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
  const createWebSocket = useMutation({
    mutationFn: (revision: string) => api<QQConnection>('/api/v1/qq/connection/websocket', { method: 'POST', body: { revision } }),
    onSuccess: () => {
      message.success('WebSocket 配置已保存，消息连接可能短暂重连')
      queryClient.invalidateQueries({ queryKey: ['qq-connection'] })
      login.refetch()
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const saveSetup = useMutation({
    mutationFn: ({ id, original, changes }: { id: string; original: QQSetup; changes: QQDraft }) =>
      api<QQSetup>(`/api/v1/qq/accounts/${id}/setup`, {
        method: 'PUT',
        body: {
          revision: original.revision,
          defaultAgentId: changes.defaultAgentId,
          rules: changes.rules.map(({ id: _id, ...rule }) => rule),
          bindings: changes.bindings,
          grants: changes.grants,
        },
      }).then((result) => result.data),
    onSuccess: (result, { id }) => {
      queryClient.setQueryData(['qq-setup', result.accountId], result)
      queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
      setDrafts((current) => ({ ...current, [id]: toDraft(result) }))
      if (selectedAccountId.current === id) setStep(3)
      message.success('QQ 帐号配置已保存')
    },
    onError: (error, { id }) => {
      message.error(errorMessage(error))
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        api<QQSetup>(`/api/v1/qq/accounts/${id}/setup`).then((result) => {
          queryClient.setQueryData(['qq-setup', id], result.data)
          setDrafts((current) => ({ ...current, [id]: toDraft(result.data) }))
          message.info('已加载最新配置，请核对后再次保存')
        }).catch(() => queryClient.invalidateQueries({ queryKey: ['qq-setup', id] }))
      }
    },
  })

  const account = accounts.find((item) => item.id === accountId)
  const loginError = login.error instanceof ApiError ? login.error : null
  const selectedOnline = Boolean(login.data?.isLogin && activeId === accountId)
  const nickname = selectedOnline ? login.data?.nickname || '' : ''
  const savedSetup = setup.data
  const canContinue = Boolean(accountId && setup.data && draft)
  const selectedAgentReady = Boolean(agents.some((agent) =>
    agent.id === draft?.defaultAgentId && agent.status === 'active' && agent.publishedVersionId))
  const hasUnsavedChanges = Boolean(setup.data && draft && JSON.stringify(draft) !== JSON.stringify(toDraft(setup.data)))

  return (
    <div className="page qq-page">
      <header className="qq-page-header">
        <div><span className="qq-eyebrow">QQ / Agent 接入</span><h2>让一个 QQ 帐号找到它的 Agent</h2></div>
        <p>按顺序完成登录、选角色和设置可对话的人。所有白名单与权限更改在最后统一保存。</p>
      </header>

      <nav className="qq-steps" aria-label="QQ 配置步骤">
        {stages.map((title, index) => (
          <Button
            key={title}
            className={`qq-step ${step === index ? 'is-current' : ''} ${index < step ? 'is-complete' : ''}`}
            type="text"
            disabled={index > 0 && (!canContinue || index === 2 && !selectedAgentReady) || index === 3 && !savedSetup}
            onClick={() => setStep(index)}
          >
            <span className="qq-step-number">0{index + 1}</span>
            <span>{title}</span>
          </Button>
        ))}
      </nav>

      {step === 0 && (
        <div className="qq-stage-grid">
          <section className="qq-stage-card">
            <div className="qq-stage-heading">
              <div><span className="qq-eyebrow">步骤 01 / 04</span><h3>登录并选择 QQ 帐号</h3></div>
              <p>用 QQ 扫码登录 NapCat。一个 NapCat 实例当前只运行一个 QQ 帐号；之前登录过的帐号配置仍会保留。</p>
            </div>
            <div className="qq-section-title">
              <span>当前登录状态</span>
              <Button icon={<ReloadOutlined />} aria-label="刷新登录状态" onClick={() => login.refetch()} loading={login.isFetching} />
            </div>
            {loginError?.code === 'NAPCAT_TOTP_REQUIRED' ? (
              <Space.Compact style={{ width: '100%' }}>
                <Input value={totpCode} maxLength={6} placeholder="WebUI 动态验证码" onChange={(event) => setTotpCode(event.target.value)} />
                <Button type="primary" disabled={!/^\d{6}$/.test(totpCode)} loading={verifyTotp.isPending} onClick={() => verifyTotp.mutate()}>验证</Button>
              </Space.Compact>
            ) : loginError ? (
              <Alert type="error" showIcon message={loginError.message} description="检查 NapCat WebUI 凭证和容器状态后，点击右上角刷新。" />
            ) : login.isLoading ? <Spin /> : login.data?.isLogin ? (
              <div className="qq-login-state">
                <Tag color={login.data.oneBotReady ? 'success' : 'warning'}>{login.data.oneBotReady ? 'QQ 与消息连接正常' : 'QQ 已登录，消息连接待就绪'}</Tag>
                <div className="qq-review-identity">
                  <span className="qq-account-avatar">{(login.data.nickname || login.data.selfId).slice(0, 1)}</span>
                  <div><strong>{login.data.nickname || 'QQ 帐号'}</strong><span>QQ 号 {login.data.selfId || '正在识别'}</span></div>
                </div>
                {login.data.isOffline && <Alert type="warning" showIcon message="QQ 当前离线，请检查 NapCat 登录状态" />}
              </div>
            ) : (
              <div className="qq-qr-state">
                {login.data?.qrcodeUrl ? <div className="qq-qr"><QRCodeSVG value={login.data.qrcodeUrl} size={192} level="M" /></div> :
                  <Alert type="info" showIcon message={login.data?.loginError || '等待 NapCat 生成登录二维码'} />}
                <p className="muted">打开手机 QQ 扫描二维码。成功后页面会自动识别帐号。</p>
                <Button icon={<ReloadOutlined />} loading={refreshQr.isPending} onClick={() => refreshQr.mutate()}>刷新二维码</Button>
              </div>
            )}
            <div className="qq-account-picker">
              <label htmlFor="qq-account-select">正在配置的 QQ 帐号</label>
              <Select
                id="qq-account-select" aria-label="正在配置的 QQ 帐号" value={accountId || undefined} placeholder="登录后选择帐号"
                onChange={chooseAccount} style={{ width: '100%' }}
                options={accounts.map((item) => ({ value: item.id, label: `QQ ${item.selfId}${item.id === activeId ? ' · 当前在线' : ' · 已保存帐号'}` }))}
              />
              {account && !selectedOnline && <p className="muted">这是此前登录过的帐号。你可以编辑配置，实际回复会在它再次登录后生效。</p>}
              {setup.data && <Button onClick={() => setStep(3)}>查看已保存配置</Button>}
            </div>
          </section>
          <section className="qq-stage-card">
            <div className="qq-stage-heading">
              <div><span className="qq-eyebrow">NapCat / OneBot</span><h3>消息连接</h3></div>
              <p>管理端通过正向 WebSocket 接收和发送 QQ 消息。以下只显示连接状态，不展示访问密钥。</p>
            </div>
            {!login.data?.isLogin ? <Alert type="info" showIcon message="先完成 QQ 登录，再检查 WebSocket 服务。" /> :
              connection.isLoading ? <Spin /> :
              connection.error ? <Alert type="warning" showIcon message={errorMessage(connection.error)} description="请检查 NapCat WebUI 网络配置。" /> :
              connection.data && (
                <>
                  <div className="qq-connection-status">
                    <Tag color={connection.data.ready ? 'success' : 'warning'}>{connection.data.ready ? '配置匹配' : '需要检查配置'}</Tag>
                    <span>目标端口 <b>{connection.data.port}</b> · 消息格式 <b>数组</b> · 访问密钥 <b>{connection.data.tokenConfigured ? '已配置' : '未配置'}</b></span>
                  </div>
                  {connection.data.services.length ? (
                    <div className="qq-service-list">
                      {connection.data.services.map((service, index) => (
                        <div key={`${service.name}:${service.port}:${index}`}>
                          <strong>{service.name || '未命名服务'}</strong>
                          <span>{service.host}:{service.port} · {service.enabled ? '启用' : '停用'} · {service.format === 'array' ? '数组' : '字符串'}</span>
                          {service.matchesManagement && <Tag color="success">管理端使用中</Tag>}
                        </div>
                      ))}
                    </div>
                  ) : <p className="muted">NapCat 尚无正向 WebSocket 服务。</p>}
                  {!connection.data.ready && (
                    <Button
                      type="primary" loading={createWebSocket.isPending} disabled={!connection.data.tokenConfigured}
                      onClick={() => createWebSocket.mutate(connection.data!.revision)}
                    >创建管理端 WebSocket 服务</Button>
                  )}
                  {!connection.data.tokenConfigured && <Alert type="warning" showIcon message="先在 .env 配置 ONEBOT_ACCESS_TOKEN，再重新启动管理端。" />}
                  {connection.data.ready && !login.data.oneBotReady && <Alert type="info" showIcon message="NapCat 服务已配置，正在等待管理端重新连接。" />}
                </>
              )}
          </section>
        </div>
      )}

      {step === 1 && draft && <AgentStep agents={agents} selected={draft.defaultAgentId} onSelect={(id) => setCurrentDraft({ ...draft, defaultAgentId: id })} />}
      {step === 2 && draft && <PermissionsStep draft={draft} onChange={setCurrentDraft} agents={agents} />}
      {step === 3 && savedSetup && (
        <>
          {hasUnsavedChanges && <Alert className="qq-unsaved-note" type="info" showIcon message="当前还有未保存的修改；此处显示服务器上次保存的配置。" />}
          <ReviewStep setup={savedSetup} agents={agents} nickname={nickname} online={selectedOnline} />
        </>
      )}
      {setup.error && accountId && <Alert type="error" showIcon message={errorMessage(setup.error)} />}

      <div className="qq-stage-actions">
        {step > 0 && <Button onClick={() => setStep(step === 3 ? 2 : step - 1)}>{step === 3 ? '返回修改' : '上一步'}</Button>}
        {step === 0 && <Button type="primary" disabled={!canContinue} onClick={() => setStep(1)}>下一步：选择 Agent</Button>}
        {step === 1 && <Button type="primary" disabled={!selectedAgentReady} onClick={() => setStep(2)}>下一步：设置白名单与权限</Button>}
        {step === 2 && <Button type="primary" disabled={!selectedAgentReady || !setup.data} loading={saveSetup.isPending} onClick={() => {
          if (draft && setup.data) saveSetup.mutate({ id: accountId, original: setup.data, changes: draft })
        }}>保存配置并查看结果</Button>}
      </div>
    </div>
  )
}
