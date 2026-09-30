import { message } from 'antd'

export type ApiResult<T> = { code: number | string; message: string; data: T; meta?: { nextCursor?: string | null } }

let csrfToken = ''
let toastFn: ((type: 'success' | 'error', content: string) => void) | null = null

export function setToast(fn: (type: 'success' | 'error', content: string) => void) {
  toastFn = fn
}

function showToast(type: 'success' | 'error', content: string) {
  if (toastFn) {
    toastFn(type, content)
    return
  }
  if (type === 'success') message.success(content)
  else message.error(content)
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

export function setCsrf(token: string) {
  csrfToken = token
}

export type ApiOptions = {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  credentials?: RequestCredentials
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method) && csrfToken) headers['x-csrf-token'] = csrfToken
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  const code = payload?.code ?? payload?.error?.code
  const messageText = payload?.message ?? payload?.error?.message
  if (!response.ok) {
    showToast('error', messageText || `request failed (${response.status})`)
    throw new ApiError(code || 'REQUEST_FAILED', messageText || `request failed (${response.status})`, response.status)
  }
  const method = (options.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && payload?.message) {
    showToast('success', payload.message)
  }
  return { data: payload?.data, meta: payload?.meta } as ApiResult<T>
}
