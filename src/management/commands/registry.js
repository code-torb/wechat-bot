export const BUILTIN_COMMANDS = Object.freeze([
  { name: '/help', builtin: 'help' },
  { name: '/reset', builtin: 'reset' },
  { name: '/new', builtin: 'newchat', aliases: ['/newchat', '/新对话', '/开始新对话'] },
])

function normalizeName(name) {
  return name.toLowerCase()
}

function matchBuiltin(rawName) {
  const normalized = normalizeName(rawName)
  return BUILTIN_COMMANDS.find((command) => command.name === rawName || (command.aliases || []).some((alias) => normalizeName(alias) === normalized))
}

export function createCommandRegistry({ db }) {
  function definition(id) {
    const command = db.prepare('SELECT * FROM command_definitions WHERE id = ?').get(id)
    if (!command || command.status !== 'active') return null
    const version = db.prepare('SELECT * FROM command_versions WHERE command_id = ? ORDER BY version DESC LIMIT 1').get(command.id)
    return version ? { ...version, name: command.name } : null
  }

  return {
    definitions(agentVersion) {
      const refs = agentVersion.commandRefs || []
      return refs.map((ref) => definition(ref)).filter(Boolean)
    },
    match(agentVersion, text) {
      const trimmed = String(text || '').trim()
      if (!trimmed.startsWith('/')) return null
      const [rawName, ...rest] = trimmed.split(/\s+/)
      const name = normalizeName(rawName.slice(1))
      const builtin = matchBuiltin(rawName)
      if (builtin) {
        return { builtin: builtin.builtin, name: rawName, args: rest }
      }
      for (const def of this.definitions(agentVersion)) {
        const aliases = JSON.parse(def.aliases_json)
        const matches = [def.name, ...aliases].some((alias) => normalizeName(alias) === name)
        if (matches) {
          return {
            commandId: def.command_id,
            versionId: def.id,
            name: rawName,
            executionType: def.execution_type,
            inputSchema: JSON.parse(def.input_schema_json),
            steps: def.steps_json ? JSON.parse(def.steps_json) : [],
            capabilities: JSON.parse(def.capabilities_json),
            args: rest,
          }
        }
      }
      return null
    },
  }
}
