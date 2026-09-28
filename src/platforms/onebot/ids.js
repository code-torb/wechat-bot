// OneBot commonly uses JSON numbers. Reject unsafe integers rather than routing
// a reply to an ID already rounded by JSON.parse; message IDs may be negative.
export function oneBotId(value, signed = false) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !(signed ? /^-?\d+$/ : /^\d+$/).test(value))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && (signed || number > 0) ? String(number) : null
}
