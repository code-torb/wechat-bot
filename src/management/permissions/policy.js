export const CAPABILITY_LEVELS = Object.freeze({
  chat: 0,
  'search.web': 1,
  'meme.send': 1,
  'files.list': 2,
  'files.read': 2,
  'files.create': 3,
  'files.update': 3,
})

export function capabilityLevel(capability) {
  return CAPABILITY_LEVELS[capability] === undefined ? -1 : CAPABILITY_LEVELS[capability]
}

export function createPolicyEngine({ db }) {
  return {
    authorize({ agentCapabilities, sceneMaxLevel, principalGrants, resourceGrants = [], capability, resourceId = '' }) {
      const level = capabilityLevel(capability)
      if (level < 0) return { allowed: false, reason: 'unknown_capability', revision: 0 }
      if (level > sceneMaxLevel) return { allowed: false, reason: 'scene_level_exceeded', revision: 0 }
      if (capability === 'chat') return { allowed: true, reason: 'ok', revision: 0 }
      if (!Array.isArray(agentCapabilities) || !agentCapabilities.includes(capability)) {
        return { allowed: false, reason: 'agent_capability_missing', revision: 0 }
      }
      const hasGrant = principalGrants.some(
        (grant) => grant.capability === capability && (grant.resourceId === '' || grant.resourceId === resourceId),
      )
      if (!hasGrant) return { allowed: false, reason: 'principal_grant_missing', revision: 0 }
      if (capability.startsWith('files.')) {
        const hasResource = resourceGrants.some((grant) => grant.resourceId === resourceId)
        if (!hasResource) return { allowed: false, reason: 'resource_grant_missing', revision: 0 }
      }
      return { allowed: true, reason: 'ok', revision: 0 }
    },
    principalGrants({ botAccountId, scene, peerId, senderId }) {
      return db
        .prepare('SELECT capability, resource_id FROM principal_grants WHERE bot_account_id = ? AND scene = ? AND peer_id = ? AND sender_id = ?')
        .all(botAccountId, scene, peerId, senderId)
        .map((row) => ({ capability: row.capability, resourceId: row.resource_id }))
    },
  }
}
