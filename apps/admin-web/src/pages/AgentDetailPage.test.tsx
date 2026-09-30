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

it('saves a zero style value with its definition id so the Agent can publish it', async () => {
  const requests: { path: string; init?: RequestInit }[] = []
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    let data: unknown = []
    if (path === '/api/v1/agents/agent-a') {
      data = {
        id: 'agent-a', name: '助手', description: '', status: 'active', revision: 3, publishedVersionId: 'v1',
        draft: {
          name: '助手', description: '', prompt: '你是助手。',
          model: { providerId: 'provider-a', credentialRef: 'credential-a', name: 'test-model', supportsTools: false },
          styleValues: [], pacing: null, capabilities: [], searchMode: 'off', resourceGrants: [], commandRefs: [],
        },
      }
    } else if (path === '/api/v1/style-definitions') {
      data = [{
        id: 'style-a', key: 'brevity', ownerAgentId: null, enabled: true, revision: 1, activationGeneration: 1,
        currentVersion: {
          id: 'style-v1', version: 1, name: '简短程度', description: '控制回答篇幅',
          defaultValue: 0.65, lowText: '解释充分', midText: '简洁', highText: '一两句回答', sortOrder: 0,
        },
      }]
    }
    return { ok: true, json: async () => ({ data }) } as Response
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/agents/agent-a']}>
        <Routes><Route path="/agents/:id" element={<AgentDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByRole('spinbutton', { name: /简短程度/ }), { target: { value: '0' } })
  fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(requests.some(({ path, init }) => path === '/api/v1/agents/agent-a' && init?.method === 'PATCH')).toBe(true))
  const saved = requests.find(({ path, init }) => path === '/api/v1/agents/agent-a' && init?.method === 'PATCH')
  expect(JSON.parse(String(saved?.init?.body)).styleValues).toEqual([{ definitionId: 'style-a', definitionVersionId: 'style-v1', value: 0 }])
})
