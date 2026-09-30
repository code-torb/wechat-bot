import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setCsrf } from '../api/client'
import AgentDetailPage from './AgentDetailPage'

beforeEach(() => {
  setCsrf('agent-csrf')
  vi.stubGlobal('fetch', vi.fn())
})

function renderAgent({ name = '助手', description = '' } = {}) {
  const requests: { path: string; init?: RequestInit }[] = []
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    let data: unknown = []
    if (path === '/api/v1/agents/agent-a') {
      data = {
        id: 'agent-a',
        name,
        description,
        status: 'active',
        revision: 3,
        publishedVersionId: 'v1',
        draft: {
          name,
          description,
          prompt: '林安宁住在上海。',
          model: { providerId: 'provider-a', credentialRef: 'credential-a', name: 'test-model', supportsTools: false },
          styleValues: [],
          pacing: null,
          capabilities: [],
          searchMode: 'off',
          resourceGrants: [],
          commandRefs: [],
        },
      }
    } else if (path === '/api/v1/style-definitions') {
      data = [
        {
          id: 'style-a',
          key: 'brevity',
          ownerAgentId: null,
          enabled: true,
          revision: 1,
          activationGeneration: 1,
          currentVersion: {
            id: 'style-v1',
            version: 1,
            name: '简短程度',
            description: '控制回答篇幅',
            defaultValue: 0.65,
            lowText: '解释充分',
            midText: '简洁',
            highText: '一两句回答',
            sortOrder: 0,
          },
        },
      ]
    } else if (path === '/api/v1/commands') {
      data = [{ id: 'command-a', name: '解释', status: 'active' }]
    } else if (path === '/api/v1/agents/default-role-background') {
      data = { background: '林安宁年轻时在出版社做编辑，后来回家照顾儿子。' }
    }
    return { ok: true, json: async () => ({ data }) } as Response
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/agents/agent-a']}>
        <Routes>
          <Route path='/agents/:id' element={<AgentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

it('adds only chosen dialogue settings and publishes role edits in a single request', async () => {
  const requests = renderAgent()
  expect(await screen.findByRole('textbox', { name: '角色设定' })).toHaveValue('林安宁住在上海。')
  expect(screen.queryByRole('spinbutton', { name: /简短程度/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument()

  await screen.findByRole('option', { name: '简短程度' })
  fireEvent.change(screen.getByRole('combobox', { name: '选择对话设定' }), { target: { value: 'style-a' } })
  fireEvent.change(await screen.findByRole('spinbutton', { name: '简短程度取值' }), { target: { value: '0' } })
  fireEvent.change(screen.getByRole('textbox', { name: '角色设定' }), { target: { value: '林安宁曾是编辑，如今照顾儿子。' } })
  expect(requests.filter(({ init }) => init?.method === 'PATCH' || init?.method === 'POST')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '保存并发布' }))
  await waitFor(() => expect(requests.some(({ path, init }) => path.endsWith('/publish') && init?.method === 'POST')).toBe(true))
  const published = requests.find(({ path, init }) => path.endsWith('/publish') && init?.method === 'POST')
  const body = JSON.parse(String(published?.init?.body))
  expect(body.expectedRevision).toBe(3)
  expect(body.draft.prompt).toBe('林安宁曾是编辑，如今照顾儿子。')
  expect(body.draft.styleValues).toEqual([{ definitionId: 'style-a', definitionVersionId: 'style-v1', value: 0 }])
  expect(requests.some(({ init }) => init?.method === 'PATCH')).toBe(false)
}, 15000)

it('removes a selected setting and keeps model and command edits local until publish', async () => {
  const requests = renderAgent()
  await screen.findByRole('textbox', { name: '角色设定' })
  await screen.findByRole('option', { name: '简短程度' })
  fireEvent.change(screen.getByRole('combobox', { name: '选择对话设定' }), { target: { value: 'style-a' } })
  await screen.findByRole('spinbutton', { name: '简短程度取值' })
  fireEvent.click(await screen.findByRole('button', { name: /移\s*除/ }))
  expect(screen.queryByRole('spinbutton', { name: '简短程度取值' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: '模型' }))
  fireEvent.change(screen.getByLabelText('模型名'), { target: { value: 'new-model' } })
  fireEvent.click(screen.getByRole('tab', { name: '命令' }))
  fireEvent.click(await screen.findByRole('button', { name: /切\s*换/ }))
  expect(requests.filter(({ init }) => init?.method === 'PATCH' || init?.method === 'POST')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '保存并发布' }))
  await waitFor(() => expect(requests.some(({ path }) => path.endsWith('/publish'))).toBe(true))
  const published = requests.find(({ path }) => path.endsWith('/publish'))
  const body = JSON.parse(String(published?.init?.body))
  expect(body.draft.styleValues).toEqual([])
  expect(body.draft.model.name).toBe('new-model')
  expect(body.draft.commandRefs).toEqual(['command-a'])
}, 15000)

it('offers the historical default Agent a narrative background without publishing it automatically', async () => {
  const requests = renderAgent({ name: '默认 Agent', description: '由旧配置导入' })
  fireEvent.click(await screen.findByRole('button', { name: '填入默认人物背景' }))
  expect(screen.getByRole('textbox', { name: '角色设定' })).toHaveValue('林安宁年轻时在出版社做编辑，后来回家照顾儿子。')
  expect(requests.some(({ init }) => init?.method === 'POST')).toBe(false)
})
