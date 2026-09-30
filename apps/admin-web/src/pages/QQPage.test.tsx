import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
