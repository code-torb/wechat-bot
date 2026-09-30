import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_STORY_BYTES, decodeStory, parseStory, parseStoryText } from './story-parser.js'

test('parseStoryText extracts attributes and background from a first-person story', () => {
  const text = `我叫林安宁，生于1988年，是一个女生。我毕业后做过六年图书编辑，后来辞职在家照顾儿子。平时我喜欢读书和做饭。
第二章
林安宁在上海闵行生活，日程被接送、家长群和账单切成一段一段。`
  const parsed = parseStoryText(text)
  assert.equal(parsed.name, '林安宁')
  assert.equal(parsed.birthDate, '1988年')
  assert.equal(parsed.gender, '女')
  assert.equal(parsed.occupation, '编辑')
  assert.match(parsed.hobbies, /读书和做饭/)
  assert.match(parsed.background, /林安宁/)
})

test('parseStory prefers the name hint and falls back to the file name', () => {
  const story = '第一章\n天亮了，街边的早餐摊冒着热气。'
  const hinted = parseStory({
    dataBase64: Buffer.from(story).toString('base64'),
    fileName: '我的小说.txt',
    nameHint: '沈宁',
  })
  assert.equal(hinted.name, '沈宁')
  const fallback = parseStory({ dataBase64: Buffer.from(story).toString('base64'), fileName: '沈宁传.txt' })
  assert.equal(fallback.name, '沈宁传')
})

test('decodeStory rejects empty and oversized input', () => {
  assert.throws(() => decodeStory(''), /empty file/)
  const oversized = Buffer.alloc(MAX_STORY_BYTES + 1, 97)
  assert.throws(() => decodeStory(oversized.toString('base64')), /5MB/)
})
