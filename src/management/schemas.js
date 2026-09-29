export const idParamSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
}

export const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        fieldErrors: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
    requestId: { type: 'string' },
  },
}
