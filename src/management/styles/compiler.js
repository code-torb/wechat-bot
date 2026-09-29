import { validatePacing } from '../../chat/pacing.js'

const MAX_SYSTEM_PROMPT = 32000

function clampValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new TypeError('style value must be between 0 and 1')
  return Math.round(n * 100) / 100
}

function anchorFor(value, anchors) {
  if (value <= 0.33) return anchors.low
  if (value <= 0.66) return anchors.mid
  return anchors.high
}

export function compileStyleValue({ name, value, lowText, midText, highText }) {
  const numeric = clampValue(value)
  const anchor = anchorFor(numeric, { low: lowText, mid: midText, high: highText })
  const position = numeric <= 0.33 ? '更接近低值' : numeric <= 0.66 ? '更接近中值' : '更接近高值'
  return `${name} ${numeric.toFixed(2)}；低/中/高行为分别为：${lowText}／${midText}／${highText}；当前${position}。`
}

export function compileStyles({ prompt, definitions }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('prompt must be a nonempty string')
  if (!Array.isArray(definitions) || definitions.length > 20) throw new TypeError('definitions must be an array of at most 20 items')
  const applied = []
  const lines = []
  for (const definition of definitions) {
    if (!definition || definition.enabled === false) continue
    const line = compileStyleValue(definition)
    applied.push({ key: definition.key, name: definition.name, value: Number(definition.value), definitionVersionId: definition.definitionVersionId })
    lines.push(line)
  }
  const systemText = lines.length ? `${prompt.trim()}\n\n对话设定：\n${lines.join('\n')}` : prompt.trim()
  if (systemText.length > MAX_SYSTEM_PROMPT) throw new TypeError(`compiled prompt exceeds ${MAX_SYSTEM_PROMPT} characters`)
  return { systemText, appliedStyles: applied }
}

export function validateStyleDefinition(input) {
  const value = clampValue(input.defaultValue)
  for (const key of ['name', 'lowText', 'midText', 'highText']) {
    if (typeof input[key] !== 'string' || !input[key].trim()) throw new TypeError(`${key} must be a nonempty string`)
  }
  return {
    key: input.key,
    name: input.name.trim(),
    description: typeof input.description === 'string' ? input.description : '',
    defaultValue: value,
    lowText: input.lowText.trim(),
    midText: input.midText.trim(),
    highText: input.highText.trim(),
    sortOrder: Number.isInteger(input.sortOrder) ? input.sortOrder : 0,
  }
}

export function validateAgentPacing(pacing) {
  if (pacing === null || pacing === undefined) return null
  return validatePacing(pacing)
}
