export const MAX_STORY_BYTES = 5 * 1024 * 1024

const GENDER_HINTS = [
  ['女生', '女'],
  ['女孩', '女'],
  ['女人', '女'],
  ['姑娘', '女'],
  ['少女', '女'],
  ['男生', '男'],
  ['男孩', '男'],
  ['男人', '男'],
  ['小伙子', '男'],
  ['少年', '男'],
]

const OCCUPATIONS = [
  '医生',
  '教师',
  '编辑',
  '工程师',
  '护士',
  '程序员',
  '画家',
  '作家',
  '记者',
  '设计师',
  '会计',
  '销售',
  '司机',
  '厨师',
  '律师',
  '警察',
  '公务员',
  '主播',
  '模特',
  '演员',
  '导演',
  '摄影师',
  '翻译',
  '健身教练',
]

export function decodeStory(dataBase64) {
  const buffer = Buffer.from(dataBase64, 'base64')
  if (buffer.length === 0) throw new Error('empty file')
  if (buffer.length > MAX_STORY_BYTES) throw new Error('file exceeds 5MB limit')
  const text = buffer
    .toString('utf8')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
  if (!text) throw new Error('file contains no readable text')
  return text
}

function headOf(text) {
  return text.slice(0, 1500)
}

function findGender(text) {
  const head = headOf(text)
  for (const [hint, gender] of GENDER_HINTS) {
    if (head.includes(hint)) return gender
  }
  return ''
}

function findName(text, nameHint) {
  const hinted = typeof nameHint === 'string' ? nameHint.trim() : ''
  if (hinted) return hinted.slice(0, 30)
  const head = headOf(text)
  const match = head.match(/(?:我叫|我的名字叫|名字叫|名叫|本人叫|本小姐叫)\s*([\u4e00-\u9fa5·A-Za-z]{2,12})/)
  return match ? match[1] : ''
}

function findBirthDate(text) {
  const match = headOf(text).match(/(?:19|20)\d{2}\s*年/)
  return match ? match[0].replace(/\s+/g, '') : ''
}

function findOccupation(text) {
  const head = headOf(text)
  return OCCUPATIONS.find((word) => head.includes(word)) || ''
}

function findHobbies(text) {
  const match = headOf(text).match(/(?:喜欢|爱好|平时爱)[^。\n]{0,24}/)
  if (!match) return ''
  return match[0]
    .replace(/^(?:喜欢|爱好|平时爱)/, '')
    .replace(/^(?:和|还有|、)/, '')
    .trim()
}

export function parseStoryText(text) {
  const clean = text
    .replace(/[\r\n]+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
  const background = clean.length > 1200 ? `${clean.slice(0, 1200)}\n\n（以上为小说原文节选，请结合原文继续完善人物经历。）` : clean
  return {
    name: findName(clean, ''),
    birthDate: findBirthDate(clean),
    gender: findGender(clean),
    occupation: findOccupation(clean),
    hobbies: findHobbies(clean),
    background,
  }
}

export function parseStory({ dataBase64, fileName, nameHint }) {
  const text = decodeStory(dataBase64)
  const parsed = parseStoryText(text)
  const fallbackName = (fileName || '')
    .replace(/\.(txt|TXT)$/, '')
    .replace(/[_\-]+/g, ' ')
    .trim()
    .slice(0, 30)
  return {
    ...parsed,
    name: parsed.name || findName(text, nameHint) || fallbackName,
  }
}
