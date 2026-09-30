import type { StyleDefinition } from '../api/types'

type Guide = {
  name: string
  description: string
  lowAnchor: string
  lowDetail: string
  highAnchor: string
  highDetail: string
}

// Older imports have short prompt anchors and no description. These explanations
// help administrators read them without silently changing published Agent versions.
const presetGuides: Record<string, Guide> = {
  flirtiness: {
    name: '暧昧程度',
    description: '控制亲近和暧昧表达的分寸；严肃话题或对方不愿意时始终保持克制。',
    lowAnchor: '中性、不主动暧昧',
    lowDetail: '保持自然礼貌，不主动使用亲密称呼、调情或暗示关系的话语。',
    highAnchor: '在适宜语境中更亲昵、带轻度暧昧表达',
    highDetail: '在双方都接受的轻松语境中使用亲近称呼和轻度暧昧表达，不越过对方边界。',
  },
  brevity: {
    name: '简短程度',
    description: '控制回答的篇幅；即使倾向简短，也保留回答问题所必需的信息。',
    lowAnchor: '解释充分',
    lowDetail: '补齐必要背景和解释，复杂问题可以分步说明并给出示例。',
    highAnchor: '倾向一两句回答',
    highDetail: '优先用一两句回答核心问题，必要的事实和限制仍要说明。',
  },
  warmth: {
    name: '温暖程度',
    description: '控制语言中的关怀感，不改变事实准确性和原有角色设定。',
    lowAnchor: '克制客观',
    lowDetail: '语气平稳客观，重点放在准确回答，较少表达个人关切。',
    highAnchor: '温柔、关心感明显',
    highDetail: '更主动地表达关心与鼓励，用温柔语气回应，但不替对方作决定。',
  },
  humor: {
    name: '幽默程度',
    description: '控制轻松和玩笑的频率，求助、报错等严肃情境仍以清晰回答为先。',
    lowAnchor: '严肃直接',
    lowDetail: '直截了当地回答，不主动插入笑话或俏皮话。',
    highAnchor: '更偏轻松有趣',
    highDetail: '适当加入轻巧的玩笑和有趣措辞，不抢走问题本身的重点。',
  },
  formality: {
    name: '正式程度',
    description: '控制用词和句式的正式程度，适配群聊闲谈或工作说明。',
    lowAnchor: '日常口语',
    lowDetail: '使用自然的日常口语和短句，像熟悉的人一样清楚交流。',
    highAnchor: '正式规范',
    highDetail: '使用更规范、完整的句式和礼貌措辞，减少口头禅与俚语。',
  },
  empathy: {
    name: '共情程度',
    description: '控制回应对方感受的主动性，同时提供实际有用的回答。',
    lowAnchor: '以解决问题为主',
    lowDetail: '优先识别问题和给出办法，不主动延长情绪回应。',
    highAnchor: '更主动回应用户感受',
    highDetail: '先承认对方的处境和感受，再给出贴合情境的帮助，不夸大理解。',
  },
  memeFrequency: {
    name: '表情包频率',
    description: '控制适宜场景中发送表情包的倾向；仍受素材授权与发送规则约束。',
    lowAnchor: '不自动发送',
    lowDetail: '不主动发送表情包，仅用文字完成回复。',
    highAnchor: '合适场景更常使用',
    highDetail: '在轻松且合适的对话中更常选用表情包，严肃或敏感话题避免使用。',
  },
}

export function styleGuidance(style: StyleDefinition) {
  const version = style.currentVersion
  const guide = style.ownerAgentId == null ? presetGuides[style.key] : undefined
  const matchesPreset = guide?.name === version.name
  return {
    description: version.description?.trim() || (matchesPreset ? guide.description : '') || '尚未填写设定说明；可点击“编辑设定”补充。',
    lowDetail: matchesPreset && version.lowText === guide.lowAnchor ? guide.lowDetail : version.lowText,
    highDetail: matchesPreset && version.highText === guide.highAnchor ? guide.highDetail : version.highText,
  }
}
