export type Agent = {
  id: string
  name: string
  description: string
  status: 'draft' | 'active' | 'disabled' | 'archived'
  revision: number
  publishedVersionId: string | null
  draft: {
    prompt: string
    attributes: {
      name: string
      birthDate: string
      gender: string
      occupation: string
      hobbies: string
    }
    model: { modelId: string; name: string; supportsTools: boolean }
    styleValues: { definitionId: string; definitionVersionId: string; value: number }[]
    pacing: { baseDelayMs: number; charsPerSecond: number; maxDelayMs: number } | null
    capabilities: string[]
    searchMode: 'off' | 'command' | 'auto'
    resourceGrants: { resourceId: string }[]
    commandRefs: string[]
  }
  createdAt: number
  updatedAt: number
}

export type AgentRelation = {
  id: string
  personName: string
  relation: string
  contextDoc: string
  updatedAt: number
  createdAt: number
}

export type KnowledgeDoc = {
  id: string
  title: string
  chars: number
  createdAt: number
  updatedAt: number
}

export type StyleDefinition = {
  id: string
  key: string
  ownerAgentId: string | null
  enabled: boolean
  revision: number
  activationGeneration: number
  currentVersion: {
    id: string
    version: number
    name: string
    description: string
    defaultValue: number
    lowText: string
    midText: string
    highText: string
    sortOrder: number
  }
}

export type Conversation = {
  id: string
  scene: 'group' | 'private'
  peerId: string
  senderId: string
  agentId: string
  epoch: number
  active: boolean
  updatedAt: number
}

export type MessageRow = {
  id: string
  epoch: number
  role: 'user' | 'assistant' | 'system_tool'
  text: string
  deliveryStatus: string
  createdAt: number
}

export type AccessRule = {
  id: string
  scopeType: 'group' | 'private' | 'group_user'
  scopeKey: string
  allow: boolean
  trigger: { mode: 'any' | 'all'; mention?: boolean; prefix?: string | null; phrase?: string | null }
  maxLevel: number
  pacingOverride: { baseDelayMs: number; charsPerSecond: number; maxDelayMs: number } | null
  quoteReply: boolean
}

export type Binding = { id: string; scope_type: string; scope_key: string; agent_id: string }

export type QQAccount = { id: string; selfId: string; enabled: boolean; defaultAgentId: string | null }

export type QQLoginStatus = {
  isLogin: boolean
  isOffline: boolean
  loginPhase: string
  loginError: string
  qrcodeUrl: string
  selfId: string
  nickname: string
  accountId: string | null
  oneBotReady: boolean
}

export type QQConnection = {
  revision: string
  port: number
  tokenConfigured: boolean
  ready: boolean
  services: { name: string; host: string; port: number; enabled: boolean; format: 'array' | 'string'; matchesManagement: boolean }[]
}

export type QQBinding = { scopeType: 'group' | 'private' | 'group_user'; scopeKey: string; agentId: string }
export type QQGrant = {
  scene: 'group' | 'private'
  peerId: string
  senderId: string
  capability: string
  resourceId: string
}
export type QQSetup = {
  accountId: string
  selfId: string
  defaultAgentId: string | null
  rules: AccessRule[]
  bindings: QQBinding[]
  grants: QQGrant[]
  revision: string
}

export type CommandDefinition = {
  id: string
  name: string
  status: string
  aliases: string[]
  executionType: 'static' | 'model_task' | 'workflow'
  steps: unknown[]
  capabilities: string[]
}

export type Model = {
  id: string
  name: string
  baseUrl: string
  embeddingModel: string
  hasSearchKey: boolean
  enabled: boolean
  keyVersion: number
  updatedAt: number
}

export type MemeAsset = { id: string; mime: string; bytes: number; tags: string[]; enabled: boolean; createdAt: number }

export type Approval = {
  id: string
  toolRunId: string
  expectedFileHash: string | null
  proposalRef: string
  expiresAt: number
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed'
}

export type AuditEvent = {
  id: string
  actorType: string
  actorId: string
  action: string
  resourceType: string
  resourceId: string
  result: string
  createdAt: number
}
