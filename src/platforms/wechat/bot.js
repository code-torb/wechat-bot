import { WechatyBuilder, ScanStatus, log } from 'wechaty'
import qrTerminal from 'qrcode-terminal'
import { defaultMessage } from '../../wechaty/sendMessage.js'
import { captureWechatMessage } from './messageStore.js'
import { getWechatRuntimeConfig } from '../../config/env.js'
import { resolveWechatPuppetConfig } from './puppetConfig.js'

function onScan(qrcode, status) {
  if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
    qrTerminal.generate(qrcode, { small: true })
    const qrcodeImageUrl = ['https://api.qrserver.com/v1/create-qr-code/?data=', encodeURIComponent(qrcode)].join('')
    console.log('onScan:', qrcodeImageUrl, ScanStatus[status], status)
  } else {
    log.info('WechatScan', '%s(%s)', ScanStatus[status], status)
  }
}

function onLogin(user) {
  console.log(`${user} has logged in`)
  const date = new Date()
  console.log(`Current time:${date}`)
  console.log('Automatic robot chat mode has been activated')
}

function onLogout(user) {
  console.log(`${user} has logged out`)
}

async function onFriendShip(friendship) {
  const friendShipRe = /chatgpt|chat/
  if (friendship.type() === 2 && friendShipRe.test(friendship.hello())) {
    await friendship.accept()
  }
}

export function createWechatBot(options = {}) {
  const config = getWechatRuntimeConfig()
  const serviceType = options.serviceType || ''
  const { puppet, puppetOptions } = resolveWechatPuppetConfig(config)
  if (config.transport === 'wechat4u' && config.loginDebug) {
    console.log('[wechat-login-debug] enabled; waiting for login events')
  }
  const bot = WechatyBuilder.build({
    name: config.transport === 'service' ? 'WechatEveryDay-service' : 'WechatEveryDay',
    puppet,
    puppetOptions,
  })

  bot.on('scan', onScan)
  bot.on('login', onLogin)
  bot.on('logout', onLogout)
  bot.on('friendship', onFriendShip)
  bot.on('message', async (message) => {
    await captureWechatMessage(message, bot, {
      dataDir: config.dataDir,
      storeMessages: config.storeMessages,
    })
    await defaultMessage(message, bot, serviceType)
  })
  bot.on('error', (error) => {
    console.error('bot error handle: ', error)
  })

  return bot
}

export function startWechatBot(options = {}) {
  const bot = createWechatBot(options)
  bot
    .start()
    .then(() => console.log('Start to log in wechat...'))
    .catch((error) => console.error('botStart error: ', error))

  return bot
}
