import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { DiagnosticWechat4u } from './loginDiagnostics.js'

function collect(error, credentials = {}) {
  const output = []
  const puppet = new DiagnosticWechat4u({}, (label, details) => output.push({ label, details }))
  const client = new EventEmitter()
  client.PROP = credentials
  puppet.wechat4u = client
  const forwarded = []
  puppet.on('error', (event) => forwarded.push(event))
  puppet.initHookEvents(client)
  client.emit('error', error)
  assert.equal(forwarded.length, 1, 'original error handling must still run')
  return output
}

test('reports init rejection and credential presence without exposing the response', () => {
  const credentials = { skey: 'secret-skey', sid: 'secret-sid', uin: '123456789', passTicket: 'secret-ticket' }
  const error = Object.assign(new Error('1 == 0'), {
    response: {
      status: 200,
      config: { url: 'https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxinit?pass_ticket=secret-ticket' },
      headers: { 'set-cookie': 'secret-cookie' },
      data: { BaseResponse: { Ret: 1, ErrMsg: 'Login rejected' }, SKey: 'secret-response-key' },
    },
  })
  const output = collect(error, credentials)
  assert.deepEqual(output, [
    {
      label: '[wechat-login-debug]',
      details: {
        stage: 'webwxinit',
        httpStatus: 200,
        ret: 1,
        errMsg: 'Login rejected',
        hasSkey: true,
        hasSid: true,
        hasUin: true,
        hasPassTicket: true,
      },
    },
  ])
  assert.doesNotMatch(JSON.stringify(output), /secret-|123456789/)
})

test('reports missing credentials even when no response exists', () => {
  const output = collect(new Error('network error'), { uin: '0' })
  assert.deepEqual(output[0].details, {
    stage: 'login',
    httpStatus: null,
    ret: null,
    errMsg: '',
    hasSkey: false,
    hasSid: false,
    hasUin: false,
    hasPassTicket: false,
  })
})

test('redacts known tickets and URLs echoed in error text', () => {
  const error = Object.assign(new Error('failed'), {
    response: {
      data: {
        BaseResponse: { Ret: 1, ErrMsg: 'secret-ticket\nhttps://wx.qq.com/?sid=other-secret' },
      },
    },
  })
  const output = collect(error, { passTicket: 'secret-ticket' })
  assert.doesNotMatch(JSON.stringify(output), /secret-ticket|other-secret|https:|\\n/)
  assert.match(output[0].details.errMsg, /REDACTED/)
})

test('does not dump unexpected structured error messages', () => {
  const error = Object.assign(new Error('failed'), {
    response: {
      data: {
        BaseResponse: { Ret: { secret: 'ticket' }, ErrMsg: { secret: 'ticket' } },
      },
    },
  })
  const output = collect(error)
  assert.equal(output[0].details.ret, null)
  assert.equal(output[0].details.errMsg, '')
})
