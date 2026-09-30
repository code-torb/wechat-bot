import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import QQPage from './QQPage'
import { setCsrf } from '../api/client'

beforeEach(() => {
  setCsrf('test-csrf')
  vi.stubGlobal('fetch', vi.fn())
  sessionStorage.clear()
})

it('renders a scannable QR code and refreshes it through the protected management API', async () => {
  const requests: { path: string; init?: RequestInit }[] = []
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    const data = path === '/api/v1/qq/login'
      ? { isLogin: false, isOffline: false, loginPhase: 'qrcode', loginError: '', qrcodeUrl: 'qq://login/123', selfId: '', accountId: null, oneBotReady: false }
      : path === '/api/v1/qq/login/refresh'
        ? { qrcodeUrl: 'qq://login/456' }
        : []
    return { ok: true, json: async () => ({ data }) } as Response
  })
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <QQPage />
    </QueryClientProvider>,
  )
  expect(screen.getByText('QQ 帐号与登录状态')).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'QQ 配置步骤' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /添加 QQ 帐号/ }))
  await waitFor(() => expect(container.querySelector('.qq-qr svg')).toBeInTheDocument())
  expect(screen.getByRole('navigation', { name: 'QQ 配置步骤' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /刷新二维码/ }))
  await waitFor(() => expect(requests.some((request) => request.path === '/api/v1/qq/login/refresh')).toBe(true))
  const refresh = requests.find((request) => request.path === '/api/v1/qq/login/refresh')
  expect(refresh?.init?.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' })
})

it('requires a different NapCat login before adding an already configured QQ account', async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = String(input)
    let data: unknown = []
    if (path === '/api/v1/qq/accounts') data = [{ id: 'bot-a', selfId: '12345', defaultAgentId: 'agent-a', enabled: true }]
    if (path === '/api/v1/qq/login') data = { isLogin: true, isOffline: false, selfId: '12345', accountId: 'bot-a', oneBotReady: true }
    if (path === '/api/v1/qq/connection') data = { revision: 'b'.repeat(64), port: 3001, tokenConfigured: true, ready: true, services: [] }
    if (path.endsWith('/setup')) data = {
      accountId: 'bot-a', selfId: '12345', defaultAgentId: 'agent-a',
      rules: [], bindings: [], grants: [], revision: 'a'.repeat(64),
    }
    return { ok: true, json: async () => ({ data }) } as Response
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><QQPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('QQ 号 12345')
  fireEvent.click(screen.getByRole('button', { name: /添加 QQ 帐号/ }))
  expect(await screen.findByText('这个 QQ 号已经配置过')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '保存草稿，选择 Agent' })).toBeDisabled()
})

it('keeps Agent and white-list changes in a draft until one submission, then shows the saved route', async () => {
  const requests: { path: string; init?: RequestInit }[] = []
  const initial = {
    accountId: 'bot-a', selfId: '12345', defaultAgentId: null,
    rules: [], bindings: [], grants: [], revision: 'a'.repeat(64),
  }
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    let data: unknown = []
    if (path === '/api/v1/agents') {
      data = [{ id: 'agent-a', name: '群聊助手', description: '回答群里的日常问题', status: 'active', publishedVersionId: 'v1', draft: { model: { name: 'deepseek-chat' } } }]
    } else if (path === '/api/v1/qq/accounts') {
      data = [{ id: 'bot-a', selfId: '12345', defaultAgentId: null, enabled: true }]
    } else if (path === '/api/v1/qq/login') {
      data = { isLogin: true, isOffline: false, selfId: '12345', nickname: '小测试', accountId: 'bot-a', oneBotReady: true, qrcodeUrl: '', loginPhase: 'online', loginError: '' }
    } else if (path === '/api/v1/qq/connection') {
      data = { revision: 'b'.repeat(64), port: 3001, tokenConfigured: true, ready: true, services: [] }
    } else if (path === '/api/v1/qq/accounts/bot-a/setup' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body))
      data = { ...initial, ...body, revision: 'c'.repeat(64), rules: body.rules.map((rule: object, index: number) => ({ ...rule, id: `rule-${index}` })) }
    } else if (path === '/api/v1/qq/accounts/bot-a/setup') {
      data = initial
    }
    return { ok: true, json: async () => ({ data }) } as Response
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><QQPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('QQ 帐号与登录状态')).toBeInTheDocument()
  expect(await screen.findByText('QQ 号 12345')).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'QQ 配置步骤' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /添加 QQ 帐号/ }))
  const next = await screen.findByRole('button', { name: '保存草稿，选择 Agent' })
  await waitFor(() => expect(next).toBeEnabled())
  fireEvent.click(next)
  expect(await screen.findByText('回答群里的日常问题')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /查看详情/ })).toHaveAttribute('href', '/agents/agent-a')
  fireEvent.click(screen.getByRole('button', { name: '选择此 Agent' }))
  fireEvent.click(screen.getByRole('button', { name: '保存草稿，设置白名单与权限' }))
  expect(screen.getByText('仅对话')).toBeInTheDocument()
  expect(screen.getByText('修改文件')).toBeInTheDocument()
  expect(requests.filter((request) => request.init?.method === 'PUT')).toHaveLength(0)
  fireEvent.change(screen.getByPlaceholderText('群号 / QQ 号'), { target: { value: '98765' } })
  fireEvent.click(screen.getByRole('button', { name: '加入草稿' }))
  await waitFor(() => expect(screen.getByText('98765')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: '更新草稿' }))
  await waitFor(() => expect(screen.getByText('L1 · 联网与表情')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: '保存草稿，预览详情' }))
  expect(screen.getByText('提交前核对帐号与 Agent')).toBeInTheDocument()
  expect(screen.getByText('L1 · 联网与表情')).toBeInTheDocument()
  expect(requests.filter((request) => request.init?.method === 'PUT')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: '查看路由' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Submit · 提交配置' }))
  await waitFor(() => expect(requests.some((request) => request.path === '/api/v1/qq/accounts/bot-a/setup' && request.init?.method === 'PUT')).toBe(true))
  const submitted = requests.find((request) => request.path === '/api/v1/qq/accounts/bot-a/setup' && request.init?.method === 'PUT')
  expect(JSON.parse(String(submitted?.init?.body))).toMatchObject({ defaultAgentId: 'agent-a', rules: [{ scopeType: 'group', scopeKey: '98765', maxLevel: 1 }] })
  expect(submitted?.init?.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' })
  expect(await screen.findByText('帐号与 Agent 已绑定')).toBeInTheDocument()
  expect(screen.getByText('QQ 帐号与登录状态')).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'QQ 配置步骤' })).not.toBeInTheDocument()
  expect(screen.getAllByText('小测试').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('查看单独绑定与工具授权详情'))
  expect(screen.getByText('发言者工具授权')).toBeInTheDocument()
}, 30000)

it('keeps each QQ account draft when returning to the list and opening another account', async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const path = String(input)
    let data: unknown = []
    if (path === '/api/v1/agents') {
      data = [{ id: 'agent-a', name: '群聊助手', description: '日常对话', status: 'active', publishedVersionId: 'v1', draft: { model: { name: 'deepseek-chat' } } }]
    } else if (path === '/api/v1/qq/accounts') {
      data = [
        { id: 'bot-a', selfId: '12345', defaultAgentId: null, enabled: true },
        { id: 'bot-b', selfId: '67890', defaultAgentId: null, enabled: true },
      ]
    } else if (path === '/api/v1/qq/login') {
      data = { isLogin: true, isOffline: false, selfId: '12345', nickname: '甲', accountId: 'bot-a', oneBotReady: true }
    } else if (path === '/api/v1/qq/connection') {
      data = { revision: 'b'.repeat(64), port: 3001, tokenConfigured: true, ready: true, services: [] }
    } else if (path.endsWith('/setup')) {
      const bot = path.includes('bot-b') ? 'bot-b' : 'bot-a'
      data = { accountId: bot, selfId: bot === 'bot-a' ? '12345' : '67890', defaultAgentId: null,
        rules: [], bindings: [], grants: [], revision: 'a'.repeat(64) }
    }
    return { ok: true, json: async () => ({ data }) } as Response
  })
  const { unmount } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><QQPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText('QQ 帐号与登录状态')
  await waitFor(() => expect(screen.getAllByRole('button', { name: '编辑配置' })).toHaveLength(2), { timeout: 5000 })
  expect(screen.getByText('当前未登录')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: '编辑配置' })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿，选择 Agent' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '保存草稿，选择 Agent' }))
  fireEvent.click(screen.getByRole('button', { name: '选择此 Agent' }))
  fireEvent.click(screen.getByRole('button', { name: '返回 QQ 帐号列表' }))
  expect(screen.getByText('此帐号有尚未提交的草稿。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '编辑配置' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿，选择 Agent' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '保存草稿，选择 Agent' }))
  expect(screen.getByRole('button', { name: '选择此 Agent' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '返回 QQ 帐号列表' }))
  expect(sessionStorage.getItem('qq-setup-drafts-v1:preview')).toContain('agent-a')
  unmount()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><QQPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getAllByRole('button', { name: '继续草稿' })).toHaveLength(2))
  fireEvent.click(screen.getAllByRole('button', { name: '继续草稿' })[0])
  await waitFor(() => expect(screen.getByRole('button', { name: '保存草稿，选择 Agent' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '保存草稿，选择 Agent' }))
  expect(screen.getByRole('button', { name: '当前选择' })).toBeInTheDocument()
}, 30000)
