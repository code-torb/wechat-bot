import { describe, expect, it, vi, beforeEach } from 'vitest'
import { api, setCsrf } from './client'

describe('api client', () => {
  beforeEach(() => {
    setCsrf('')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('attaches csrf token and json content type to mutations', async () => {
    setCsrf('csrf-x')
    const captured: RequestInit[] = []
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      captured.push(init as RequestInit)
      return { ok: true, json: async () => ({ data: { ok: true } }) } as Response
    })
    await api('/api/v1/agents/1', { method: 'PATCH', body: { name: 'x' }, headers: { 'if-match': '1' } })
    expect(captured[0].headers).toMatchObject({ 'content-type': 'application/json', 'x-csrf-token': 'csrf-x', 'if-match': '1' })
    expect(captured[0].credentials).toBe('include')
  })

  it('never attaches csrf to GET requests', async () => {
    setCsrf('csrf-x')
    const captured: RequestInit[] = []
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      captured.push(init as RequestInit)
      return { ok: true, json: async () => ({ data: [] }) } as Response
    })
    await api('/api/v1/agents')
    expect(JSON.stringify(captured[0].headers)).not.toContain('csrf')
  })
})
