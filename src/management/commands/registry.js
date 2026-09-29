export const BUILTIN_COMMANDS = Object.freeze(['/help', '/reset'])

function normalizeName(name) {
  return name.toLowerCase()
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
      if (BUILTIN_COMMANDS.includes(rawName)) {
        return { builtin: rawName === '/help' ? 'help' : 'reset', name: rawName, args: rest }
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
