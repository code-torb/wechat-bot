import { createHmac, randomUUID } from 'node:crypto'
import { connect } from 'node:net'

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`
}

export function createFileClient({ socketPath, secret, timeoutMs = 8000 }) {
  function request(payload) {
    const body = { id: randomUUID(), nonce: randomUUID(), expiresAt: Date.now() + timeoutMs, ...payload }
    body.signature = createHmac('sha256', secret).update(canonical(body)).digest('hex')
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath)
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('file executor timeout'))
      }, timeoutMs)
      let buffer = ''
      socket.on('connect', () => {
        socket.write(JSON.stringify(body) + '\n')
      })
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        if (!buffer.includes('\n')) return
        clearTimeout(timer)
        const [line] = buffer.split('\n')
        socket.end()
        try {
          resolve(JSON.parse(line))
        } catch {
          reject(new Error('file executor returned invalid response'))
        }
      })
      socket.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  return {
    call({ resourceId, action, relativePath, content, expectedHash, signal }) {
      return request({ resourceId, action, relativePath, content, expectedHash })
    },
  }
}
