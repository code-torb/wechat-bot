import { randomUUID } from 'node:crypto'

export function createToolRegistry({ db, policyEngine, searchWeb, memes }) {
  const perRun = new Map()

  function budget(runId) {
    let entry = perRun.get(runId)
    if (!entry) {
      entry = { calls: 0, rounds: 0, searches: 0 }
      perRun.set(runId, entry)
    }
    return entry
  }

  return {
    async execute({ context, call, agentVersion, runId, sceneMaxLevel }) {
      const entry = budget(runId)
      if (entry.calls >= 6) return { status: 'failed', errorCode: 'TOOL_LIMIT' }
      entry.calls += 1
      const name = call.name
      if (!['search.web', 'meme.select'].includes(name)) return { status: 'denied', errorCode: 'UNKNOWN_TOOL' }
      if (name === 'search.web') {
        if (entry.searches >= 2) return { status: 'failed', errorCode: 'SEARCH_LIMIT' }
        const check = policyEngine.authorize({
          agentCapabilities: agentVersion.capabilities || [],
          sceneMaxLevel,
          principalGrants: policyEngine.principalGrants(context),
          resourceGrants: agentVersion.resourceGrants || [],
          capability: 'search.web',
        })
        if (!check.allowed) return { status: 'denied', errorCode: 'SEARCH_DENIED' }
        entry.searches += 1
        const query = typeof call.arguments?.query === 'string' ? call.arguments.query.slice(0, 200) : ''
        if (!query) return { status: 'failed', errorCode: 'SEARCH_QUERY_EMPTY' }
        try {
          const result = await searchWeb({ query, limit: 5 })
          db.prepare(
            'INSERT INTO tool_runs (id, run_id, call_id, name, resource_id, arguments_hash, status, sanitized_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(
            randomUUID(),
            runId,
            call.id,
            name,
            '',
            JSON.stringify(call.arguments),
            'ok',
            JSON.stringify({ results: result.results }),
            Date.now(),
            Date.now(),
          )
          return { status: 'ok', data: result }
        } catch (error) {
          return { status: 'failed', errorCode: 'SEARCH_UNAVAILABLE' }
        }
      }
      if (name === 'meme.select') {
        const check = policyEngine.authorize({
          agentCapabilities: agentVersion.capabilities || [],
          sceneMaxLevel,
          principalGrants: policyEngine.principalGrants(context),
          resourceGrants: agentVersion.resourceGrants || [],
          capability: 'meme.send',
        })
        if (!check.allowed) return { status: 'denied', errorCode: 'MEME_DENIED' }
        const assetId = typeof call.arguments?.assetId === 'string' ? call.arguments.assetId : ''
        const selected = memes.select({
          context: { turn: entry.calls, authorize: () => true },
          assetId,
          lastMemeTurn: entry.lastMemeTurn ?? null,
          frequency: call.arguments?.frequency ?? 0.2,
          scene: call.arguments?.scene || 'chat',
        })
        if (!selected) return { status: 'failed', errorCode: 'MEME_UNAVAILABLE' }
        entry.lastMemeTurn = entry.calls
        db.prepare(
          'INSERT INTO tool_runs (id, run_id, call_id, name, resource_id, arguments_hash, status, sanitized_result, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          randomUUID(),
          runId,
          call.id,
          name,
          '',
          JSON.stringify(call.arguments),
          'ok',
          JSON.stringify({ assetId: selected.assetId, mime: selected.mime }),
          Date.now(),
          Date.now(),
        )
        return { status: 'ok', data: { assetId: selected.assetId, mime: selected.mime } }
      }
      return { status: 'denied', errorCode: 'UNKNOWN_TOOL' }
    },
    reset(runId) {
      perRun.delete(runId)
    },
  }
}
