import OpenAI from 'openai'

export function createModelClient({ secretStore }) {
  return async function complete({ model, modelName, messages, tools, signal, transport }) {
    if (!model) throw new Error('model is required')
    const apiKey = secretStore.withSecret(model, (value) => value)
    const client = new OpenAI({
      apiKey: apiKey || 'unset',
      baseURL: model.base_url,
      maxRetries: 0,
      timeout: 45000,
      fetch: transport,
    })
    const response = await client.chat.completions.create(
      {
        model: modelName,
        messages,
        ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
        max_tokens: 1000,
      },
      { signal },
    )
    const message = response?.choices?.[0]?.message
    const text = typeof message?.content === 'string' ? message.content.trim() : ''
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((call) => ({
          id: call.id,
          name: call.function?.name || '',
          arguments: JSON.parse(call.function?.arguments || '{}'),
        }))
      : []
    const usage = response?.usage
      ? { inputTokens: response.usage.prompt_tokens ?? null, outputTokens: response.usage.completion_tokens ?? null }
      : null
    return { text, toolCalls, usage }
  }
}
