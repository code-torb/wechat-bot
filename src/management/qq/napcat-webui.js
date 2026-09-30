import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export class NapCatWebUiError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message)
    this.code = code
    this.statusCode = statusCode
    this.exposeMessage = message
  }
}

export function createNapCatWebUi({ baseUrl = 'http://napcat:6099', tokenFile = '', token = '', fetchFn = globalThis.fetch, now = Date.now }) {
  let credential = ''
  let credentialUntil = 0
  let authenticatedToken = ''

  function getToken() {
    if (tokenFile) {
      try {
        const config = JSON.parse(readFileSync(tokenFile, 'utf8'))
        if (typeof config.token === 'string' && config.token) return config.token
      } catch {
        // Fall back to the explicitly supplied token without exposing file contents.
      }
    }
    if (token) return token
    throw new NapCatWebUiError('NAPCAT_WEBUI_CONFIG', '无法读取 NapCat WebUI 凭证，请配置 NAPCAT_WEBUI_SECRET_KEY', 503)
  }

  async function post(path, body = {}, authorization = '') {
    let response
    try {
      response = await fetchFn(`${baseUrl}/api/${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 401 || payload.code === 401 || ['Authorization Failed', 'Token has been revoked'].includes(payload.message)) {
        throw new NapCatWebUiError('NAPCAT_WEBUI_UNAUTHORIZED', 'NapCat WebUI 凭证已失效', 401)
      }
      if (path === 'auth/login' && payload.message === 'login rate limit') {
        throw new NapCatWebUiError('NAPCAT_WEBUI_RATE_LIMIT', 'NapCat WebUI 登录过于频繁，请稍后手动刷新', 429)
      }
      if (path === 'auth/login' && (!response.ok || payload.code !== 0)) {
        throw new NapCatWebUiError('NAPCAT_WEBUI_AUTH', 'NapCat WebUI 登录失败，请确认凭证或验证码', 503)
      }
      if (!response.ok || payload.code !== 0) {
        throw new NapCatWebUiError('NAPCAT_WEBUI_ERROR', 'NapCat 接口请求失败')
      }
      return payload.data
    } catch (error) {
      if (error instanceof NapCatWebUiError) throw error
      throw new NapCatWebUiError('NAPCAT_WEBUI_UNAVAILABLE', '无法连接 NapCat WebUI')
    }
  }

  async function authenticate(totpCode) {
    const secret = getToken()
    const hash = createHash('sha256').update(`${secret}.napcat`).digest('hex')
    let data
    try {
      data = await post('auth/login', { hash, ...(totpCode ? { totpCode } : {}) })
    } catch (error) {
      if (error.code !== 'NAPCAT_WEBUI_UNAUTHORIZED') throw error
      throw new NapCatWebUiError('NAPCAT_WEBUI_AUTH', 'NapCat WebUI 登录失败，请确认凭证或验证码', 503)
    }
    if (data?.require2FA) throw new NapCatWebUiError('NAPCAT_TOTP_REQUIRED', '请输入 NapCat WebUI 的动态验证码', 409)
    if (typeof data?.Credential !== 'string' || !data.Credential) {
      throw new NapCatWebUiError('NAPCAT_WEBUI_AUTH', 'NapCat WebUI 登录失败，请确认凭证或验证码', 503)
    }
    credential = data.Credential
    credentialUntil = now() + 55 * 60 * 1000
    authenticatedToken = secret
  }

  async function call(path, body = {}) {
    const currentToken = getToken()
    if (!credential || now() >= credentialUntil || currentToken !== authenticatedToken) await authenticate()
    try {
      return await post(path, body, credential)
    } catch (error) {
      if (error.code !== 'NAPCAT_WEBUI_UNAUTHORIZED') throw error
      credential = ''
      await authenticate()
      return post(path, body, credential)
    }
  }

  return {
    verify: (totpCode) => authenticate(totpCode),
    async status() {
      const data = await call('QQLogin/CheckLoginStatus')
      let selfId = ''
      let nickname = ''
      if (data?.isLogin) {
        const info = await call('QQLogin/GetQQLoginInfo')
        selfId = String(info?.uin || info?.selfId || '')
        nickname = typeof info?.nickname === 'string' ? info.nickname.slice(0, 80) : ''
      }
      return {
        isLogin: Boolean(data?.isLogin),
        isOffline: Boolean(data?.isOffline),
        loginPhase: typeof data?.loginPhase === 'string' ? data.loginPhase : '',
        loginError: typeof data?.loginError === 'string' ? data.loginError : '',
        qrcodeUrl: typeof data?.qrcodeurl === 'string' && data.qrcodeurl.length <= 4096 ? data.qrcodeurl : '',
        selfId: /^\d+$/.test(selfId) ? selfId : '',
        nickname,
      }
    },
    async refresh() {
      const data = await call('QQLogin/RefreshQRcode')
      return {
        qrcodeUrl: typeof data?.qrcodeurl === 'string' && data.qrcodeurl.length <= 4096 ? data.qrcodeurl : '',
        restarting: Boolean(data?.restarting),
      }
    },
    oneBotConfig: () => call('OB11Config/GetConfig'),
    setOneBotConfig: (config) => call('OB11Config/SetConfig', { config: JSON.stringify(config) }),
  }
}
