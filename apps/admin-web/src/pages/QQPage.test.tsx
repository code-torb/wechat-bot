import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import QQPage from './QQPage'
import { setCsrf } from '../api/client'

beforeEach(() => {
  setCsrf('test-csrf')
  vi.stubGlobal('fetch', vi.fn())
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
  await waitFor(() => expect(container.querySelector('.qq-qr svg')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: /刷新二维码/ }))
  await waitFor(() => expect(requests.some((request) => request.path === '/api/v1/qq/login/refresh')).toBe(true))
  const refresh = requests.find((request) => request.path === '/api/v1/qq/login/refresh')
  expect(refresh?.init?.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' })
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
  const next = await screen.findByRole('button', { name: '下一步：选择 Agent' })
  await waitFor(() => expect(next).toBeEnabled())
  fireEvent.click(next)
  expect(await screen.findByText('回答群里的日常问题')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /查看详情/ })).toHaveAttribute('href', '/agents/agent-a')
  fireEvent.click(screen.getByRole('button', { name: '选择此 Agent' }))
  fireEvent.click(screen.getByRole('button', { name: '下一步：设置白名单与权限' }))
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
  fireEvent.click(screen.getByRole('button', { name: '保存配置并查看结果' }))
  await waitFor(() => expect(requests.some((request) => request.path === '/api/v1/qq/accounts/bot-a/setup' && request.init?.method === 'PUT')).toBe(true))
  const submitted = requests.find((request) => request.path === '/api/v1/qq/accounts/bot-a/setup' && request.init?.method === 'PUT')
  expect(JSON.parse(String(submitted?.init?.body))).toMatchObject({ defaultAgentId: 'agent-a', rules: [{ scopeType: 'group', scopeKey: '98765', maxLevel: 1 }] })
  expect(submitted?.init?.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' })
  expect(await screen.findByText('帐号与 Agent 已绑定')).toBeInTheDocument()
  expect(screen.getByText('小测试')).toBeInTheDocument()
  fireEvent.click(screen.getByText('查看单独绑定与工具授权详情'))
  expect(screen.getByText('发言者工具授权')).toBeInTheDocument()
}, 30000)

it('keeps an unsaved Agent selection when switching between QQ accounts', async () => {
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
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><QQPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步：选择 Agent' })).toBeEnabled(), { timeout: 5000 })
  fireEvent.click(screen.getByRole('button', { name: '下一步：选择 Agent' }))
  fireEvent.click(screen.getByRole('button', { name: '选择此 Agent' }))
  fireEvent.click(screen.getByRole('button', { name: '01 QQ 帐号' }))
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '正在配置的 QQ 帐号' }))
  fireEvent.click(await screen.findByText('QQ 67890 · 已保存帐号'))
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步：选择 Agent' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '下一步：选择 Agent' }))
  expect(screen.getByRole('button', { name: '选择此 Agent' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '01 QQ 帐号' }))
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '正在配置的 QQ 帐号' }))
  fireEvent.click(await screen.findByText('QQ 12345 · 当前在线'))
  fireEvent.click(screen.getByRole('button', { name: '下一步：选择 Agent' }))
  expect(screen.getByRole('button', { name: '当前选择' })).toBeInTheDocument()
}, 30000)
