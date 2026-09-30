import { createHash } from 'node:crypto'
import { NapCatWebUiError } from './napcat-webui.js'

const MANAGED_NAME = 'management-forward-ws'

function revision(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex')
}

export function createNapCatConnection({ webui, accessToken, wsUrl }) {
  const port = Number(new URL(wsUrl).port || 80)

  function servers(config) {
    const network = config?.network
    if (!network || !Array.isArray(network.websocketServers)) {
      throw new NapCatWebUiError('NAPCAT_CONFIG_INVALID', 'NapCat 网络配置格式不支持，请在 NapCat WebUI 检查配置')
    }
    return network.websocketServers
  }

  function describe(config) {
    const entries = servers(config)
    const target = entries.find((item) => item.port === port)
    const ready = Boolean(
      target?.enable &&
      ['0.0.0.0', '::'].includes(target.host) &&
      target.messagePostFormat === 'array' &&
      accessToken &&
      target.token === accessToken,
    )
    return {
      revision: revision(config),
      port,
      tokenConfigured: Boolean(accessToken),
      ready,
      services: entries.map((item) => ({
        name: typeof item.name === 'string' ? item.name : '',
        host: typeof item.host === 'string' ? item.host : '',
        port: item.port,
        enabled: Boolean(item.enable),
        format: item.messagePostFormat === 'array' ? 'array' : 'string',
        matchesManagement: item === target && ready,
      })),
    }
  }

  return {
    async status() {
      return describe(await webui.oneBotConfig())
    },
    async ensureWebSocket(expectedRevision) {
      if (!accessToken) throw new NapCatWebUiError('ONEBOT_TOKEN_REQUIRED', '先在 .env 配置 ONEBOT_ACCESS_TOKEN 并重启管理端', 422)
      const config = await webui.oneBotConfig()
      if (revision(config) !== expectedRevision) {
        throw new NapCatWebUiError('CONFLICT', 'NapCat 配置已变化，请刷新连接状态后重试', 409)
      }
      const entries = servers(config)
      const occupied = entries.find((item) => item.port === port && item.name !== MANAGED_NAME)
      if (occupied) {
        if (describe(config).ready) return describe(config)
        throw new NapCatWebUiError('PORT_IN_USE', `端口 ${port} 已由其他 WebSocket 服务占用，请先在 NapCat WebUI 中调整`, 409)
      }
      const managed = entries.find((item) => item.name === MANAGED_NAME)
      const settings = {
        name: MANAGED_NAME,
        enable: true,
        host: '0.0.0.0',
        port,
        messagePostFormat: 'array',
        reportSelfMessage: false,
        token: accessToken,
        enableForcePushEvent: true,
        debug: false,
        heartInterval: 30000,
      }
      const updated = managed ? entries.map((item) => (item === managed ? { ...item, ...settings } : item)) : [...entries, settings]
      await webui.setOneBotConfig({ ...config, network: { ...config.network, websocketServers: updated } })
      return describe(await webui.oneBotConfig())
    },
  }
}
