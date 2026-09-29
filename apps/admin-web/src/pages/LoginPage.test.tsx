import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginPage from './LoginPage'

describe('LoginPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('logs in with credentials and hands the csrf token to the shell', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { username: 'owner', role: 'owner', csrf: 'csrf-abc' } }),
    } as Response)
    const onLogin = vi.fn()
    const onSuccess = vi.fn()
    render(<LoginPage onLogin={onLogin} onSuccess={onSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('csrf-abc'))
    expect(onSuccess).toHaveBeenCalled()
  })

  it('does not hand off when login fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'invalid credentials' } }),
    } as Response)
    const onLogin = vi.fn()
    const onSuccess = vi.fn()
    render(<LoginPage onLogin={onLogin} onSuccess={onSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button'))
    expect(await waitFor(() => expect(onSuccess).not.toHaveBeenCalled()))
    expect(onLogin).not.toHaveBeenCalled()
  })
})
