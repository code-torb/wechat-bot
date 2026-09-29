export function loadUser(db, userId) {
  const row = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(userId)
  if (!row || row.disabled) return null
  const scopes = db
    .prepare('SELECT resource_type, resource_id, operation FROM admin_scopes WHERE user_id = ?')
    .all(userId)
    .map((scope) => ({ resourceType: scope.resource_type, resourceId: scope.resource_id, operation: scope.operation }))
  return { userId: row.id, username: row.username, role: row.role, scopes }
}

export function canAccess(user, { resourceType, resourceId = '', operation }) {
  if (!user) return false
  if (user.role === 'owner') return true
  return user.scopes.some(
    (scope) =>
      scope.resourceType === resourceType &&
      (scope.resourceId === '' || scope.resourceId === resourceId) &&
      (scope.operation === operation || scope.operation === `*:${resourceType}`),
  )
}

export function requireCapability({ resourceType, resourceId, operation }) {
  return async (request, reply) => {
    if (!request.auth?.user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } })
    if (!canAccess(request.auth.user, { resourceType, resourceId, operation })) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'insufficient scope' } })
    }
  }
}
