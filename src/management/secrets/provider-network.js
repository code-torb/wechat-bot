import { isIP } from 'node:net'

const METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal'])

export function hostPolicy(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/\[|\]/g, '')
  if (METADATA_HOSTS.has(host)) return { blocked: true, reason: 'metadata' }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
    return { blocked: true, reason: 'loopback' }
  }
  if (isIP(host)) {
    const first = host.split('.').map(Number)
    if (first[0] === 10 || first[0] === 172 || first[0] === 192) return { blocked: true, reason: 'private' }
  }
  return { blocked: false, reason: 'ok' }
}

export function validateProviderBaseUrl(baseUrl) {
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('provider base URL must be valid')
  }
  const policy = hostPolicy(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && policy.reason === 'loopback')) {
    throw new Error('provider base URL must use https (loopback http allowed for self-hosted)')
  }
  if (policy.blocked) throw new Error(`provider base URL points to ${policy.reason} host`)
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('provider base URL must not contain credentials or query')
  return parsed.origin + parsed.pathname.replace(/\/+$/, '')
}
