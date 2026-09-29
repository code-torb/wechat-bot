import { registerAuthRoutes } from './auth/routes.js'
import { registerCredentialRoutes } from './secrets/routes.js'
import { registerAgentRoutes } from './agents/routes.js'
import { registerAuditRoutes } from './audit/routes.js'
import { registerStyleRoutes } from './styles/routes.js'
import { registerQQRoutes } from './qq/routes.js'
import { registerConversationRoutes } from './conversations/routes.js'
import { registerPermissionRoutes } from './permissions/routes.js'
import { registerCommandRoutes } from './commands/routes.js'

export function registerManagementRoutes(app, deps) {
  registerAuthRoutes(app, deps)
  registerCredentialRoutes(app, deps)
  registerAgentRoutes(app, deps)
  registerAuditRoutes(app, deps)
  registerStyleRoutes(app, deps)
  registerQQRoutes(app, deps)
  registerConversationRoutes(app, deps)
  registerPermissionRoutes(app, deps)
  registerCommandRoutes(app, deps)
}
