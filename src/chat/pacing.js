export const DEFAULT_PACING = Object.freeze({ baseDelayMs: 0, charsPerSecond: 0, maxDelayMs: 15000 })

export function calculateReplyDelay(text, pacing) {
  const count = Array.from(String(text)).length
  const lengthDelay = pacing.charsPerSecond === 0 ? 0 : Math.ceil((count / pacing.charsPerSecond) * 1000)
  return Math.min(pacing.maxDelayMs, pacing.baseDelayMs + lengthDelay)
}

export function validatePacing(pacing) {
  if (pacing === null || pacing === undefined) return null
  const baseDelayMs = Number(pacing.baseDelayMs)
  const charsPerSecond = Number(pacing.charsPerSecond)
  const maxDelayMs = Number(pacing.maxDelayMs)
  if (!Number.isSafeInteger(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 60000) {
    throw new TypeError('baseDelayMs must be an integer between 0 and 60000')
  }
  if (!Number.isSafeInteger(charsPerSecond) || charsPerSecond < 0 || charsPerSecond > 200) {
    throw new TypeError('charsPerSecond must be 0 or an integer between 1 and 200')
  }
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs < 0 || maxDelayMs > 60000 || maxDelayMs < baseDelayMs) {
    throw new TypeError('maxDelayMs must be an integer between baseDelayMs and 60000')
  }
  return { baseDelayMs, charsPerSecond, maxDelayMs }
}

export function resolvePacing({ system = {}, agent = {}, scope = {} } = {}) {
  const raw = {
    baseDelayMs: scope.baseDelayMs ?? agent.baseDelayMs ?? system.baseDelayMs ?? DEFAULT_PACING.baseDelayMs,
    charsPerSecond: scope.charsPerSecond ?? agent.charsPerSecond ?? system.charsPerSecond ?? DEFAULT_PACING.charsPerSecond,
    maxDelayMs: scope.maxDelayMs ?? agent.maxDelayMs ?? system.maxDelayMs ?? DEFAULT_PACING.maxDelayMs,
  }
  return validatePacing(raw)
}
