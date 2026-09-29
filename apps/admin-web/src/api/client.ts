export type ApiResult<T> = { data: T; meta?: { nextCursor?: string | null } }

let csrfToken = ''

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
    throw new Error(payload?.error?.message || `request failed (${response.status})`)
  }
  return payload as ApiResult<T>
}
