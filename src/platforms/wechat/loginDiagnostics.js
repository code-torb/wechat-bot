import { PuppetWechat4u } from 'wechaty-puppet-wechat4u'

function diagnosticDetails(error, credentials = {}) {
  const response = error?.response
  const base = response?.data?.BaseResponse
  let errMsg = typeof base?.ErrMsg === 'string' ? base.ErrMsg : ''
  for (const value of Object.values(credentials)) {
    if (typeof value === 'string' && value) errMsg = errMsg.split(value).join('[REDACTED]')
  }
  errMsg = errMsg
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, 500)
  let stage = 'login'
  try {
    if (new URL(response?.config?.url).pathname.endsWith('/webwxinit')) stage = 'webwxinit'
  } catch {
    // A transport failure may not include a response URL.
  }
  return {
    stage,
    httpStatus: typeof response?.status === 'number' ? response.status : null,
    ret: typeof base?.Ret === 'number' ? base.Ret : null,
    errMsg,
    hasSkey: Boolean(credentials.skey),
    hasSid: Boolean(credentials.sid),
    hasUin: Boolean(Number(credentials.uin)),
    hasPassTicket: Boolean(credentials.passTicket),
  }
}

export class DiagnosticWechat4u extends PuppetWechat4u {
  constructor(options = {}, report = (label, details) => console.error(label, details)) {
    super(options)
    this.reportLoginDiagnostic = report
  }

  // Adapter 1.14.14 calls this hook for each client before starting login.
  // Capture selected fields before its error handler serializes away response data.
  initHookEvents(client) {
    client.on('error', (error) => {
      this.reportLoginDiagnostic('[wechat-login-debug]', diagnosticDetails(error, client.PROP))
    })
    super.initHookEvents(client)
  }
}
