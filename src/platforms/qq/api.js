// No platform-specific details escape this transport into the chat core.
export function createQQApi({
  appId,
  appSecret,
  apiBaseURL = 'https://api.bot.qq.com',
  tokenURL = 'https://api.bot.qq.com/app/getAppAccessToken',
  timeoutMs = 10000,
  fetchImpl = fetch,
  now = Date.now,
}) {
  let cachedToken,
    expiresAt = 0,
    tokenRequest

  async function request(url, body, headers = {}) {
    let response, data
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      })
      data = await response.json()
    } catch {
      throw new Error('QQ API network, timeout or invalid response error')
    }
    const errorCode = data?.err_code ?? data?.code
    if (!response.ok || !data || (errorCode !== undefined && Number(errorCode) !== 0)) {
      const code = Number.isSafeInteger(Number(errorCode)) ? Number(errorCode) : 'unknown'
      const error = new Error(`QQ API HTTP ${response.status}, code ${code}`)
      error.status = response.status
      throw error
    }
    return data
  }

  async function getToken() {
    if (cachedToken && now() < expiresAt) return cachedToken
    if (tokenRequest) return tokenRequest
    tokenRequest = (async () => {
      const data = await request(tokenURL, { appId, clientSecret: appSecret })
      const seconds = Number(data.expires_in)
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('QQ API returned invalid access token metadata')
      }
      cachedToken = data.access_token
      expiresAt = now() + Math.max(0, seconds - Math.min(60, seconds / 2)) * 1000
      return cachedToken
    })()
    try {
      return await tokenRequest
    } finally {
      tokenRequest = undefined
    }
  }

  return {
    async sendReply(message, text) {
      if (!message.groupId || !message.messageId || typeof text !== 'string' || !text.trim()) {
        throw new Error('QQ reply requires groupId, messageId and text')
      }
      const url = `${apiBaseURL.replace(/\/$/, '')}/v2/groups/${encodeURIComponent(message.groupId)}/messages`
      const body = { content: text, msg_type: 0, msg_id: message.messageId, msg_seq: 1 }
      let token = await getToken()
      try {
        return await request(url, body, { Authorization: `QQBot ${token}` })
      } catch (error) {
        if (error.status !== 401) throw error
        // A concurrent request may already have replaced the rejected token.
        if (cachedToken === token) {
          cachedToken = undefined
          expiresAt = 0
        }
        token = await getToken()
        return request(url, body, { Authorization: `QQBot ${token}` })
      }
    },
  }
}
