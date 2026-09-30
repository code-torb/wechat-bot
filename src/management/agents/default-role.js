// This is a character's life history, not an instruction about how to answer.
export const DEFAULT_ROLE_BACKGROUND = `林安宁三十八岁，住在上海闵行。大学毕业后她做过六年图书编辑，结婚、生下儿子后，先是为照顾生病的婆婆请长假，后来索性辞了职。儿子如今读小学五年级，她的日程被接送、家长群消息、医院挂号和家里的账单切成一段一段。丈夫周叙在一家大型企业做管理，收入稳定，也习惯独自决定家里的大事。

两年前，林安宁陪朋友去社区图书馆办活动，认识了比她年轻的纪录片摄影师陈屿。他们从聊书和旧工作开始，后来有了一段婚外感情。她舍不得儿子，也无法再假装婚姻里没有裂缝。事情传开后，双方父母的劝说、熟人的议论和孩子的困惑接连压了过来。她与周叙分居，靠接出版社的校对零活维持自己的开销，在争取更多陪伴儿子的时间与重新找工作之间反复奔忙。如今她仍住在这座城市，周末照看儿子，平日投简历，偶尔也会回图书馆帮忙。`

const LEGACY_GENERIC_ROLES = new Set([
  '你是一个友好、简洁的中文聊天助手。请用纯文本回答，避免过长的回复。',
  '你是一个友好、简洁的中文聊天助手。请用纯文本回答。',
])

export function upgradeUntouchedDefaultRole({ db, service, logger = console }) {
  const rows = db
    .prepare(
      "SELECT id, revision, draft_json FROM agents WHERE name = '默认 Agent' AND description = '由旧配置导入' AND status = 'active' AND revision = 3",
    )
    .all()
  let updated = 0
  for (const row of rows) {
    const draft = JSON.parse(row.draft_json)
    if (!LEGACY_GENERIC_ROLES.has(draft.prompt)) continue
    const firstVersion = db.prepare('SELECT version, actor_id FROM agent_versions WHERE agent_id = ? ORDER BY version LIMIT 1').get(row.id)
    if (firstVersion?.version !== 1 || firstVersion.actor_id !== 'legacy-import') continue
    try {
      service.publish({
        agentId: row.id,
        expectedRevision: row.revision,
        actorId: 'system:default-role-update',
        draft: { prompt: DEFAULT_ROLE_BACKGROUND },
      })
      updated += 1
    } catch (error) {
      if (error.code !== 'VALIDATION' && error.code !== 'CONFLICT') throw error
      logger.warn({ agentId: row.id, code: error.code }, '默认 Agent 背景升级已跳过，原配置保持不变')
    }
  }
  return updated
}
