import { DiagnosticWechat4u } from './loginDiagnostics.js'

export function resolveWechatPuppetConfig(config) {
  if (config.transport === 'service') {
    const token = config.puppetServiceToken.trim()
    if (!token) throw new Error('WECHAT_TRANSPORT=service requires WECHATY_PUPPET_SERVICE_TOKEN')

    return {
      puppet: 'wechaty-puppet-service',
      puppetOptions: {
        token,
        ...(config.puppetServiceEndpoint.trim() ? { endpoint: config.puppetServiceEndpoint.trim() } : {}),
      },
    }
  }

  if (config.transport === 'wechat4u') {
    const puppetOptions = {
      uos: true,
      ...(process.env.CHROME_BIN ? { endpoint: process.env.CHROME_BIN } : {}),
    }
    return {
      puppet: config.loginDebug ? new DiagnosticWechat4u(puppetOptions) : 'wechaty-puppet-wechat4u',
      puppetOptions,
    }
  }

  throw new Error(`Unsupported WECHAT_TRANSPORT: ${config.transport}`)
}
