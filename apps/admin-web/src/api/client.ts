export type ApiResult<T> = { data: T; meta?: { nextCursor?: string | null } }

let csrfToken = ''

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
  if (!response.ok) {
    throw new ApiError(payload?.error?.code || 'REQUEST_FAILED', payload?.error?.message || `request failed (${response.status})`, response.status)
  }
  return payload as ApiResult<T>
}
