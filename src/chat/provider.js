import OpenAI from 'openai'

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a nonempty string`)
  }
  return value.trim()
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

function requireBaseURL(value) {
  const baseURL = requireNonEmptyString(value, 'baseURL')
  let parsed
  try {
    parsed = new URL(baseURL)
  } catch {
    throw new TypeError('baseURL must be a valid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('baseURL must use http or https')
  }

  return baseURL
}

export function createChatProvider({ apiKey, baseURL, model, timeoutMs = 45000, maxTokens = 1000 } = {}) {
  const client = new OpenAI({
    apiKey: requireNonEmptyString(apiKey, 'apiKey'),
    baseURL: requireBaseURL(baseURL),
    maxRetries: 0,
    timeout: requirePositiveInteger(timeoutMs, 'timeoutMs'),
  })
  const modelName = requireNonEmptyString(model, 'model')
  const tokenLimit = requirePositiveInteger(maxTokens, 'maxTokens')

  return async function complete(messages) {
    const response = await client.chat.completions.create({
      model: modelName,
      messages,
      max_tokens: tokenLimit,
    })

    const content = response?.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content.trim() : ''
    if (!text) {
      throw new Error('empty or invalid provider output')
    }

    return text
  }
}
