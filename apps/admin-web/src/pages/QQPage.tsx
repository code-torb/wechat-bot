import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Input, Space, Spin, Tag, message } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { Agent, QQAccount, QQConnection, QQLoginStatus, QQSetup } from '../api/types'
import { AgentStep, PermissionsStep, ReviewStep, type QQDraft } from './qq/SetupSteps'

const stages = ['QQ 帐号', '选择 Agent', '白名单与权限', '确认并提交']
const draftStorageKey = (owner: string) => `qq-setup-drafts-v1:${owner}`
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : '操作失败')
const toDraft = (setup: QQSetup): QQDraft => ({
  defaultAgentId: setup.defaultAgentId,
  rules: setup.rules,
  bindings: setup.bindings,
  grants: setup.grants,
})
type StoredDraft = { revision: string; changes: QQDraft }
function readDrafts(owner: string): Record<string, StoredDraft> {
  try {
    const value = JSON.parse(sessionStorage.getItem(draftStorageKey(owner)) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => {
        const draft = entry as StoredDraft
        return (
          typeof draft?.revision === 'string' &&
          draft.changes &&
          Array.isArray(draft.changes.rules) &&
          Array.isArray(draft.changes.bindings) &&
          Array.isArray(draft.changes.grants)
        )
      }),
    ) as Record<string, StoredDraft>
  } catch {
    return {}
  }
}

export default function QQPage({ owner = 'preview' }: { owner?: string }) {
  const queryClient = useQueryClient()
  const [view, setView] = useState<'list' | 'wizard'>('list')
  const [intent, setIntent] = useState<'add' | 'edit'>('add')
  const [accountId, setAccountId] = useState('')
  const [expandedAccountId, setExpandedAccountId] = useState('')
  const [step, setStep] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, StoredDraft>>(() => readDrafts(owner))
  const [totpCode, setTotpCode] = useState('')
  const selectedAccountId = useRef(accountId)
  selectedAccountId.current = accountId
  useEffect(() => {
    try {
      sessionStorage.setItem(draftStorageKey(owner), JSON.stringify(drafts))
    } catch {
      /* Browser storage may be unavailable. */
    }
  }, [drafts, owner])

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
    refetchInterval: (query) => (query.state.error ? false : 5000),
    retry: false,
  })
  const activeId = login.data?.accountId
  useEffect(() => {
    if (view === 'wizard' && intent === 'add') setAccountId(activeId || '')
  }, [activeId, intent, view])
  useEffect(() => {
    if (activeId) queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
  }, [activeId, queryClient])

  const startWizard = (kind: 'add' | 'edit', id = '') => {
    setIntent(kind)
    setAccountId(kind === 'add' ? activeId || '' : id)
    setStep(0)
    setView('wizard')
  }
  const setup = useQuery({
    queryKey: ['qq-setup', accountId],
    queryFn: () => api<QQSetup>(`/api/v1/qq/accounts/${accountId}/setup`).then((result) => result.data),
    enabled: view === 'wizard' && Boolean(accountId),
    retry: false,
  })
  const expandedSetup = useQuery({
    queryKey: ['qq-setup', expandedAccountId],
    queryFn: () => api<QQSetup>(`/api/v1/qq/accounts/${expandedAccountId}/setup`).then((result) => result.data),
    enabled: view === 'list' && Boolean(expandedAccountId),
    retry: false,
  })
  const draft = drafts[accountId]?.changes ?? (setup.data ? toDraft(setup.data) : null)
  const setCurrentDraft = (changes: QQDraft) => {
    if (!setup.data || !accountId) return
    setDrafts((current) => ({
      ...current,
      [accountId]: { revision: current[accountId]?.revision || setup.data.revision, changes },
    }))
  }
  const dropDraft = (id: string) =>
    setDrafts((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  const connection = useQuery({
    queryKey: ['qq-connection'],
    queryFn: () => api<QQConnection>('/api/v1/qq/connection').then((result) => result.data),
    enabled: Boolean(login.data?.isLogin),
    retry: false,
  })

  const refreshQr = useMutation({
    mutationFn: () => api('/api/v1/qq/login/refresh', { method: 'POST' }),
    onSuccess: () => login.refetch(),
  })
  const verifyTotp = useMutation({
    mutationFn: () => api('/api/v1/qq/login/verify', { method: 'POST', body: { totpCode } }),
    onSuccess: () => {
      setTotpCode('')
      login.refetch()
    },
  })
  const createWebSocket = useMutation({
    mutationFn: (revision: string) => api<QQConnection>('/api/v1/qq/connection/websocket', { method: 'POST', body: { revision } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qq-connection'] })
      login.refetch()
    },
  })
  const saveSetup = useMutation({
    mutationFn: ({ id, revision, changes }: { id: string; revision: string; changes: QQDraft }) =>
      api<QQSetup>(`/api/v1/qq/accounts/${id}/setup`, {
        method: 'PUT',
        body: {
          revision,
          defaultAgentId: changes.defaultAgentId,
          rules: changes.rules.map(({ id: _id, ...rule }) => rule),
          bindings: changes.bindings,
          grants: changes.grants,
        },
      }).then((result) => result.data),
    onSuccess: (result, { id }) => {
      queryClient.setQueryData(['qq-setup', result.accountId], result)
      queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
      dropDraft(id)
      if (selectedAccountId.current === id) {
        setExpandedAccountId(id)
        setView('list')
        setStep(0)
      }
    },
    onError: (error, { id }) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        queryClient.invalidateQueries({ queryKey: ['qq-setup', id] })
        message.info('服务器配置已有变化，草稿仍保留。请核对后重新载入或调整。')
      }
    },
  })

  const account = accounts.find((item) => item.id === accountId)
  const loginError = login.error instanceof ApiError ? login.error : null
  const selectedOnline = Boolean(login.data?.isLogin && activeId === accountId)
  const nickname = selectedOnline ? login.data?.nickname || '' : ''
  const alreadyConfigured = Boolean(intent === 'add' && account?.defaultAgentId)
  const canContinue = Boolean(accountId && setup.data && draft && !alreadyConfigured)
  const selectedAgentReady = Boolean(
    agents.some((agent) => agent.id === draft?.defaultAgentId && agent.status === 'active' && agent.publishedVersionId),
  )
  const staleDraft = Boolean(setup.data && drafts[accountId] && drafts[accountId].revision !== setup.data.revision)
  const previewSetup = setup.data && draft ? { ...setup.data, ...draft } : null
  const sortedAccounts = [...accounts].sort((first, second) => Number(second.id === activeId) - Number(first.id === activeId))

  return (
    <div className='page qq-page'>
      <header className='qq-page-header'>
        <div>
          <span className='qq-eyebrow'>QQ / Agent 接入</span>
          <h2>{view === 'list' ? 'QQ 帐号与登录状态' : '配置 QQ 帐号'}</h2>
        </div>
        <p>
          {view === 'list'
            ? '查看已登录及曾配置的 QQ 帐号。NapCat 同时只运行一个帐号，其余帐号再次登录后才会回复。'
            : '逐步保存本浏览器中的草稿，最后核对详情并提交后才会修改运行配置。'}
        </p>
      </header>

      {view === 'list' && (
        <>
          <div className='qq-list-toolbar'>
            <span>共 {accounts.length} 个 QQ 帐号</span>
            <Space>
              <Button
                icon={<ReloadOutlined />}
                loading={login.isFetching}
                onClick={() => {
                  login.refetch()
                  queryClient.invalidateQueries({ queryKey: ['qq-accounts'] })
                }}
              >
                刷新状态
              </Button>
              <Button type='primary' icon={<PlusOutlined />} onClick={() => startWizard('add')}>
                添加 QQ 帐号
              </Button>
            </Space>
          </div>
          {loginError && <Alert className='qq-list-alert' type='warning' showIcon message={`NapCat 登录状态暂不可用：${loginError.message}`} />}
          {login.isLoading && !accounts.length ? (
            <Spin />
          ) : sortedAccounts.length ? (
            <div className='qq-account-grid'>
              {sortedAccounts.map((item) => {
                const currentLogin = Boolean(login.data?.isLogin && activeId === item.id)
                const online = currentLogin && !login.data?.isOffline
                const agent = agents.find((candidate) => candidate.id === item.defaultAgentId)
                return (
                  <section key={item.id} className={`qq-account-card ${expandedAccountId === item.id ? 'is-selected' : ''}`}>
                    <div className='qq-review-identity'>
                      <span className='qq-account-avatar'>{((online && login.data?.nickname) || item.selfId).slice(0, 1)}</span>
                      <div>
                        <strong>{(online && login.data?.nickname) || `QQ ${item.selfId}`}</strong>
                        <span>QQ 号 {item.selfId}</span>
                      </div>
                    </div>
                    <Tag color={!item.enabled ? 'error' : online && login.data?.oneBotReady ? 'success' : currentLogin ? 'warning' : 'default'}>
                      {!item.enabled
                        ? '帐号已停用'
                        : currentLogin
                          ? online
                            ? login.data?.oneBotReady
                              ? '在线 · 消息连接正常'
                              : '已登录 · 消息连接待就绪'
                            : '已登录 · QQ 当前离线'
                          : '当前未登录'}
                    </Tag>
                    <div className='qq-account-agent'>
                      默认 Agent：
                      {agent ? (
                        <Link to={`/agents/${agent.id}`} target='_blank' rel='noopener noreferrer'>
                          {agent.name}
                        </Link>
                      ) : (
                        item.defaultAgentId || '尚未配置'
                      )}
                    </div>
                    {drafts[item.id] && <p className='qq-draft-hint'>此帐号有尚未提交的草稿。</p>}
                    <Space>
                      <Button onClick={() => setExpandedAccountId(expandedAccountId === item.id ? '' : item.id)}>
                        {expandedAccountId === item.id ? '收起详情' : '查看详情'}
                      </Button>
                      <Button onClick={() => startWizard('edit', item.id)}>{drafts[item.id] ? '继续草稿' : '编辑配置'}</Button>
                    </Space>
                  </section>
                )
              })}
            </div>
          ) : (
            <Alert type='info' showIcon message='还没有 QQ 帐号' description='点击“添加 QQ 帐号”进入扫码和配置流程。' />
          )}
          {expandedAccountId && (
            <section className='qq-list-detail'>
              <div className='qq-list-detail-heading'>
                <h3>QQ {accounts.find((item) => item.id === expandedAccountId)?.selfId || ''} 的配置详情</h3>
                <Button onClick={() => startWizard('edit', expandedAccountId)}>编辑此帐号</Button>
              </div>
              {expandedSetup.isLoading ? (
                <Spin />
              ) : expandedSetup.error ? (
                <Alert type='error' showIcon message={errorMessage(expandedSetup.error)} />
              ) : (
                expandedSetup.data && (
                  <ReviewStep
                    setup={expandedSetup.data}
                    agents={agents}
                    nickname={activeId === expandedAccountId ? login.data?.nickname || '' : ''}
                    online={Boolean(login.data?.isLogin && !login.data.isOffline && activeId === expandedAccountId)}
                  />
                )
              )}
            </section>
          )}
        </>
      )}

      {view === 'wizard' && (
        <>
          <div className='qq-wizard-bar'>
            <Button onClick={() => setView('list')}>返回 QQ 帐号列表</Button>
            <span>草稿保存在本浏览器会话；只有最后一步提交才会生效。</span>
          </div>
          <nav className='qq-steps' aria-label='QQ 配置步骤'>
            {stages.map((title, index) => (
              <Button
                key={title}
                className={`qq-step ${step === index ? 'is-current' : ''} ${index < step ? 'is-complete' : ''}`}
                type='text'
                disabled={index > step}
                onClick={() => setStep(index)}
              >
                <span className='qq-step-number'>0{index + 1}</span>
                <span>{title}</span>
              </Button>
            ))}
          </nav>

          {step === 0 && (
            <div className='qq-stage-grid'>
              <section className='qq-stage-card'>
                <div className='qq-stage-heading'>
                  <div>
                    <span className='qq-eyebrow'>步骤 01 / 04</span>
                    <h3>扫码并确认 QQ 帐号</h3>
                  </div>
                  <p>添加新帐号时用 QQ 扫码登录 NapCat；编辑已有帐号可以直接继续。一个 NapCat 实例当前只运行一个 QQ 帐号。</p>
                </div>
                <div className='qq-section-title'>
                  <span>当前登录状态</span>
                  <Button icon={<ReloadOutlined />} aria-label='刷新登录状态' onClick={() => login.refetch()} loading={login.isFetching} />
                </div>
                {loginError?.code === 'NAPCAT_TOTP_REQUIRED' ? (
                  <Space.Compact style={{ width: '100%' }}>
                    <Input value={totpCode} maxLength={6} placeholder='WebUI 动态验证码' onChange={(event) => setTotpCode(event.target.value)} />
                    <Button type='primary' disabled={!/^\d{6}$/.test(totpCode)} loading={verifyTotp.isPending} onClick={() => verifyTotp.mutate()}>
                      验证
                    </Button>
                  </Space.Compact>
                ) : loginError ? (
                  <Alert type='error' showIcon message={loginError.message} description='检查 NapCat WebUI 凭证和容器状态后，点击右上角刷新。' />
                ) : login.isLoading ? (
                  <Spin />
                ) : login.data?.isLogin ? (
                  <div className='qq-login-state'>
                    <Tag color={login.data.oneBotReady ? 'success' : 'warning'}>
                      {login.data.oneBotReady ? 'QQ 与消息连接正常' : 'QQ 已登录，消息连接待就绪'}
                    </Tag>
                    <div className='qq-review-identity'>
                      <span className='qq-account-avatar'>{(login.data.nickname || login.data.selfId).slice(0, 1)}</span>
                      <div>
                        <strong>{login.data.nickname || 'QQ 帐号'}</strong>
                        <span>QQ 号 {login.data.selfId || '正在识别'}</span>
                      </div>
                    </div>
                    {login.data.isOffline && <Alert type='warning' showIcon message='QQ 当前离线，请检查 NapCat 登录状态' />}
                  </div>
                ) : (
                  <div className='qq-qr-state'>
                    {login.data?.qrcodeUrl ? (
                      <div className='qq-qr'>
                        <QRCodeSVG value={login.data.qrcodeUrl} size={192} level='M' />
                      </div>
                    ) : (
                      <Alert type='info' showIcon message={login.data?.loginError || '等待 NapCat 生成登录二维码'} />
                    )}
                    <p className='muted'>打开手机 QQ 扫描二维码。成功后页面会自动识别帐号。</p>
                    <Button icon={<ReloadOutlined />} loading={refreshQr.isPending} onClick={() => refreshQr.mutate()}>
                      刷新二维码
                    </Button>
                  </div>
                )}
                <div className='qq-account-picker'>
                  <label>本次草稿关联的帐号</label>
                  {account || setup.data ? (
                    <strong>
                      QQ {account?.selfId || setup.data?.selfId}
                      {selectedOnline ? ' · 当前已登录' : ' · 已保存帐号'}
                    </strong>
                  ) : (
                    <p className='muted'>等待扫码登录并识别 QQ 号，识别成功后才可以继续。</p>
                  )}
                  {account && !selectedOnline && <p className='muted'>这是此前登录过的帐号。你可以编辑配置，实际回复会在它再次登录后生效。</p>}
                  {alreadyConfigured && (
                    <Alert
                      type='info'
                      showIcon
                      message='这个 QQ 号已经配置过'
                      description='添加新帐号前，请在 NapCat WebUI 切换 QQ 登录；若要修改当前帐号，请返回列表点击“编辑配置”。'
                    />
                  )}
                </div>
              </section>
              <section className='qq-stage-card'>
                <div className='qq-stage-heading'>
                  <div>
                    <span className='qq-eyebrow'>NapCat / OneBot</span>
                    <h3>消息连接</h3>
                  </div>
                  <p>管理端通过正向 WebSocket 接收和发送 QQ 消息。以下只显示连接状态，不展示访问密钥。</p>
                </div>
                {!login.data?.isLogin ? (
                  <Alert type='info' showIcon message='先完成 QQ 登录，再检查 WebSocket 服务。' />
                ) : connection.isLoading ? (
                  <Spin />
                ) : connection.error ? (
                  <Alert type='warning' showIcon message={errorMessage(connection.error)} description='请检查 NapCat WebUI 网络配置。' />
                ) : (
                  connection.data && (
                    <>
                      <div className='qq-connection-status'>
                        <Tag color={connection.data.ready ? 'success' : 'warning'}>{connection.data.ready ? '配置匹配' : '需要检查配置'}</Tag>
                        <span>
                          目标端口 <b>{connection.data.port}</b> · 消息格式 <b>数组</b> · 访问密钥{' '}
                          <b>{connection.data.tokenConfigured ? '已配置' : '未配置'}</b>
                        </span>
                      </div>
                      {connection.data.services.length ? (
                        <div className='qq-service-list'>
                          {connection.data.services.map((service, index) => (
                            <div key={`${service.name}:${service.port}:${index}`}>
                              <strong>{service.name || '未命名服务'}</strong>
                              <span>
                                {service.host}:{service.port} · {service.enabled ? '启用' : '停用'} · {service.format === 'array' ? '数组' : '字符串'}
                              </span>
                              {service.matchesManagement && <Tag color='success'>管理端使用中</Tag>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className='muted'>NapCat 尚无正向 WebSocket 服务。</p>
                      )}
                      {!connection.data.ready && (
                        <Button
                          type='primary'
                          loading={createWebSocket.isPending}
                          disabled={!connection.data.tokenConfigured}
                          onClick={() => createWebSocket.mutate(connection.data!.revision)}
                        >
                          创建管理端 WebSocket 服务
                        </Button>
                      )}
                      {!connection.data.tokenConfigured && (
                        <Alert type='warning' showIcon message='先在 .env 配置 ONEBOT_ACCESS_TOKEN，再重新启动管理端。' />
                      )}
                      {connection.data.ready && !login.data.oneBotReady && (
                        <Alert type='info' showIcon message='NapCat 服务已配置，正在等待管理端重新连接。' />
                      )}
                    </>
                  )
                )}
              </section>
            </div>
          )}

          {step === 1 && draft && (
            <AgentStep agents={agents} selected={draft.defaultAgentId} onSelect={(id) => setCurrentDraft({ ...draft, defaultAgentId: id })} />
          )}
          {step === 2 && draft && <PermissionsStep draft={draft} onChange={setCurrentDraft} agents={agents} />}
          {step === 3 && previewSetup && <ReviewStep setup={previewSetup} agents={agents} nickname={nickname} online={selectedOnline} draftMode />}
          {staleDraft && (
            <Alert
              className='qq-unsaved-note'
              type='warning'
              showIcon
              message='服务器配置在草稿编辑期间发生变化'
              description={
                <Space>
                  草稿仍在本浏览器中。为避免覆盖其他修改，请重新载入此帐号的当前配置。
                  <Button
                    size='small'
                    onClick={() => {
                      dropDraft(accountId)
                      setStep(0)
                    }}
                  >
                    重新载入服务器配置
                  </Button>
                </Space>
              }
            />
          )}
          {setup.error && accountId && <Alert type='error' showIcon message={errorMessage(setup.error)} />}

          <div className='qq-stage-actions'>
            {step > 0 && <Button onClick={() => setStep(step - 1)}>上一步</Button>}
            {step === 0 && (
              <Button
                type='primary'
                disabled={!canContinue}
                onClick={() => {
                  if (draft) setCurrentDraft(draft)
                  setStep(1)
                }}
              >
                保存草稿，选择 Agent
              </Button>
            )}
            {step === 1 && (
              <Button type='primary' disabled={!selectedAgentReady} onClick={() => setStep(2)}>
                保存草稿，设置白名单与权限
              </Button>
            )}
            {step === 2 && (
              <Button type='primary' disabled={!selectedAgentReady} onClick={() => setStep(3)}>
                保存草稿，预览详情
              </Button>
            )}
            {step === 3 && (
              <Button
                type='primary'
                disabled={!selectedAgentReady || staleDraft || !setup.data}
                loading={saveSetup.isPending}
                onClick={() => {
                  if (draft && setup.data)
                    saveSetup.mutate({ id: accountId, revision: drafts[accountId]?.revision || setup.data.revision, changes: draft })
                }}
              >
                Submit · 提交配置
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
