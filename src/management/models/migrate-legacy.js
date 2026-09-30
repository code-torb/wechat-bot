export function migrateLegacyModels({ db, secretStore }) {
  if (!secretStore) return 0
  const count = db.prepare('SELECT COUNT(*) AS count FROM models').get().count
  if (count > 0) return 0
  const providers = db.prepare('SELECT * FROM providers').all()
  let migrated = 0
  for (const provider of providers) {
    const modelCred = db.prepare("SELECT * FROM credentials WHERE provider_id = ? AND purpose = 'model' AND enabled = 1").get(provider.id)
    if (!modelCred) continue
    let apiKey = null
    try {
      apiKey = secretStore.withSecret(modelCred, (value) => value)
    } catch {
      apiKey = null
    }
    if (!apiKey) continue
    const now = Date.now()
    const model = {
      id: provider.id,
      name: provider.name,
      base_url: provider.base_url,
      embedding_model: provider.embedding_model || '',
      enabled: provider.enabled,
      key_version: secretStore.keyVersion,
      aad_kind: 'model',
      created_at: now,
      updated_at: now,
    }
    const apiEnvelope = secretStore.encrypt({ record: model, plaintext: apiKey })
    let searchEnvelope = null
    const searchCred = db.prepare("SELECT * FROM credentials WHERE provider_id = ? AND purpose = 'search'").get(provider.id)
    if (searchCred) {
      try {
        const searchKey = secretStore.withSecret(searchCred, (value) => value)
        searchEnvelope = secretStore.encrypt({
          record: { ...model, key_version: secretStore.keyVersion },
          plaintext: searchKey,
        })
      } catch {
        searchEnvelope = null
      }
    }
    db.prepare(
      `INSERT INTO models (id, name, base_url, aad_kind, api_key_cipher, api_key_nonce, api_key_tag, key_version,
         search_key_cipher, search_key_nonce, search_key_tag, search_key_version, embedding_model, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      model.id,
      model.name,
      model.base_url,
      'model',
      apiEnvelope.cipher,
      apiEnvelope.nonce,
      apiEnvelope.tag,
      apiEnvelope.keyVersion,
      searchEnvelope?.cipher ?? null,
      searchEnvelope?.nonce ?? null,
      searchEnvelope?.tag ?? null,
      searchEnvelope?.keyVersion ?? null,
      model.embedding_model,
      model.enabled,
      now,
      now,
    )
    const rewriteModel = (draftOrSnapshot) => {
      const data = JSON.parse(draftOrSnapshot)
      if (!data.model || typeof data.model !== 'object') return JSON.stringify(data)
      data.model = {
        modelId: provider.id,
        name: typeof data.model.name === 'string' ? data.model.name : '',
        supportsTools: Boolean(data.model.supportsTools),
      }
      return JSON.stringify(data)
    }
    const drafts = db.prepare("SELECT id, draft_json FROM agents WHERE json_extract(draft_json, '$.model.providerId') = ?").all(provider.id)
    for (const row of drafts) {
      db.prepare('UPDATE agents SET draft_json = ? WHERE id = ?').run(rewriteModel(row.draft_json), row.id)
    }
    const versions = db
      .prepare("SELECT id, snapshot_json FROM agent_versions WHERE json_extract(snapshot_json, '$.model.providerId') = ?")
      .all(provider.id)
    for (const row of versions) {
      db.prepare('UPDATE agent_versions SET snapshot_json = ? WHERE id = ?').run(rewriteModel(row.snapshot_json), row.id)
    }
    migrated += 1
  }
  return migrated
}
