import { registerAuthRoutes } from './auth/routes.js'
import { registerCredentialRoutes } from './secrets/routes.js'
import { registerAgentRoutes } from './agents/routes.js'
import { registerAuditRoutes } from './audit/routes.js'

export function registerManagementRoutes(app, deps) {
  registerAuthRoutes(app, deps)
  registerCredentialRoutes(app, deps)
  registerAgentRoutes(app, deps)
  registerAuditRoutes(app, deps)
}
