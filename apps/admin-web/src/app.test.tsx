import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import App from './app'
import { setCsrf } from './api/client'

beforeEach(() => {
  setCsrf('')
  vi.stubGlobal('fetch', vi.fn())
})

it('restores csrf from an existing session before enabling mutations', async () => {
  const requests: { path: string; init?: RequestInit }[] = []
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    if (path === '/api/v1/auth/me') {
      return { ok: true, json: async () => ({ data: { username: 'owner', role: 'owner', csrf: 'restored-token' } }) } as Response
    }
    if (path === '/api/v1/agents' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ data: { id: 'new-agent' } }) } as Response
    }
    return { ok: true, json: async () => ({ data: [] }) } as Response
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/agents']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.change(await screen.findByPlaceholderText('名称'), { target: { value: '测试 Agent' } })
  fireEvent.click(screen.getByRole('button', { name: '新建 Agent' }))
  await waitFor(() => expect(requests.some((request) => request.path === '/api/v1/agents' && request.init?.method === 'POST')).toBe(true))
  const mutation = requests.find((request) => request.path === '/api/v1/agents' && request.init?.method === 'POST')
  expect(mutation?.init?.headers).toMatchObject({ 'x-csrf-token': 'restored-token' })
})
