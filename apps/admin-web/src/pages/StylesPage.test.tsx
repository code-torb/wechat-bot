import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StylesPage from './StylesPage'
import { setCsrf } from '../api/client'
import type { StyleDefinition } from '../api/types'

const preset: StyleDefinition = {
  id: 'style-1',
  key: 'brevity',
  enabled: true,
  revision: 1,
  activationGeneration: 1,
  ownerAgentId: null,
  currentVersion: {
    id: 'version-1',
    version: 1,
    name: '简短程度',
    description: '',
    defaultValue: 0.65,
    lowText: '解释充分',
    midText: '简洁',
    highText: '倾向一两句回答',
    sortOrder: 0,
  },
}

beforeEach(() => {
  setCsrf('styles-csrf')
  vi.stubGlobal('fetch', vi.fn())
})

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StylesPage />
    </QueryClientProvider>,
  )
}

it('explains the preset and both ends of its 0–1 scale in the list and detail view', async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ data: [preset] }),
  } as Response)
  renderPage()
  await screen.findByText('简短程度')
  expect(screen.getByText(/控制回答的篇幅/)).toBeInTheDocument()
  expect(screen.getByText(/补齐必要背景和解释/)).toBeInTheDocument()
  expect(screen.getByText(/优先用一两句回答/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
  const detail = screen.getByRole('dialog', { name: '简短程度 · 设定详情' })
  expect(within(detail).getByText('解释充分')).toBeInTheDocument()
  expect(within(detail).getByText('倾向一两句回答')).toBeInTheDocument()
  expect(within(detail).getByText(/补齐必要背景和解释/)).toBeInTheDocument()
})

it('creates and edits styles in a modal, keeping zero as a valid default', async () => {
  const requests: { path: string; init?: RequestInit }[] = []
  let styles: StyleDefinition[] = [preset]
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input)
    requests.push({ path, init })
    if (path === '/api/v1/style-definitions' && init?.method === 'POST') {
      const values = JSON.parse(String(init.body))
      styles = [...styles, {
        ...preset,
        id: 'style-2',
        key: values.key,
        currentVersion: { ...preset.currentVersion, ...values, id: 'version-2', version: 1 },
      }]
      return { ok: true, json: async () => ({ data: styles[1] }) } as Response
    }
    if (path === '/api/v1/style-definitions/style-1' && init?.method === 'PATCH') {
      const values = JSON.parse(String(init.body))
      styles = [{ ...preset, currentVersion: { ...preset.currentVersion, ...values, id: 'version-3', version: 2 } }, styles[1]]
      return { ok: true, json: async () => ({ data: styles[0] }) } as Response
    }
    return { ok: true, json: async () => ({ data: styles }) } as Response
  })

  renderPage()
  await screen.findByText('简短程度')
  fireEvent.click(screen.getByRole('button', { name: '新增对话设定' }))
  const createDialog = screen.getByRole('dialog', { name: '新增对话设定' })
  fireEvent.change(within(createDialog).getByLabelText('唯一标识'), { target: { value: 'curiosity' } })
  fireEvent.change(within(createDialog).getByLabelText('名称'), { target: { value: '好奇程度' } })
  fireEvent.change(within(createDialog).getByLabelText('设定说明'), { target: { value: '控制主动追问的程度。' } })
  fireEvent.change(within(createDialog).getByLabelText('默认值'), { target: { value: '0' } })
  fireEvent.change(within(createDialog).getByLabelText('0 · 最低程度'), { target: { value: '直接回答，不主动追问。' } })
  fireEvent.change(within(createDialog).getByLabelText('0.5 · 中间程度'), { target: { value: '需要时问一个问题。' } })
  fireEvent.change(within(createDialog).getByLabelText('1 · 最高程度'), { target: { value: '主动探索对方的意图。' } })
  fireEvent.click(within(createDialog).getByRole('button', { name: '创建设定' }))
  await waitFor(() => expect(requests.some(({ init }) => init?.method === 'POST')).toBe(true))
  expect(JSON.parse(String(requests.find(({ init }) => init?.method === 'POST')?.init?.body))).toMatchObject({
    key: 'curiosity', description: '控制主动追问的程度。', defaultValue: 0,
    lowText: '直接回答，不主动追问。', highText: '主动探索对方的意图。',
  })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增对话设定' })).not.toBeInTheDocument())
  await screen.findByText('好奇程度')

  fireEvent.click(screen.getAllByRole('button', { name: '编辑设定' })[0])
  const editDialog = screen.getByRole('dialog', { name: '编辑对话设定' })
  expect(within(editDialog).getByLabelText('唯一标识')).toBeDisabled()
  expect(within(editDialog).getByLabelText('0 · 最低程度')).toHaveValue('解释充分')
  fireEvent.change(within(editDialog).getByLabelText('0 · 最低程度'), { target: { value: '先交代背景，再给出完整解释。' } })
  fireEvent.change(within(editDialog).getByLabelText('默认值'), { target: { value: '0' } })
  fireEvent.click(within(editDialog).getByRole('button', { name: '保存修改' }))
  await waitFor(() => expect(requests.some(({ path, init }) => path.endsWith('/style-1') && init?.method === 'PATCH')).toBe(true))
  expect(JSON.parse(String(requests.find(({ path, init }) => path.endsWith('/style-1') && init?.method === 'PATCH')?.init?.body))).toMatchObject({
    defaultValue: 0, lowText: '先交代背景，再给出完整解释。',
  })
  expect(requests.find(({ init }) => init?.method === 'POST')?.init?.headers).toMatchObject({ 'x-csrf-token': 'styles-csrf' })
})
