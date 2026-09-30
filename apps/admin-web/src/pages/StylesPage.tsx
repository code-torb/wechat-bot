import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Spin, Switch, Tag } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '../api/client'
import type { StyleDefinition } from '../api/types'
import { styleGuidance } from './styleGuidance'

type StyleValues = {
  key: string
  name: string
  description: string
  defaultValue: number
  lowText: string
  midText: string
  highText: string
}
type Editor = { mode: 'create' } | { mode: 'edit'; style: StyleDefinition }
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : '操作失败')

export default function StylesPage() {
  const queryClient = useQueryClient()
  const [form] = Form.useForm<StyleValues>()
  const [editor, setEditor] = useState<Editor | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const {
    data: styles = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['styles'],
    queryFn: () => api<StyleDefinition[]>('/api/v1/style-definitions').then((result) => result.data),
  })
  const detail = styles.find((style) => style.id === detailId)

  useEffect(() => {
    if (!editor) return
    form.resetFields()
    if (editor.mode === 'create') {
      form.setFieldsValue({ defaultValue: 0.5 })
    } else {
      const version = editor.style.currentVersion
      form.setFieldsValue({
        key: editor.style.key,
        name: version.name,
        description: styleGuidance(editor.style).description,
        defaultValue: version.defaultValue,
        lowText: version.lowText,
        midText: version.midText,
        highText: version.highText,
      })
    }
  }, [editor, form])

  const create = useMutation({
    mutationFn: (values: StyleValues) => api<StyleDefinition>('/api/v1/style-definitions', { method: 'POST', body: values }),
    onSuccess: () => {
      setEditor(null)
      queryClient.invalidateQueries({ queryKey: ['styles'] })
    },
  })
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Omit<StyleValues, 'key'> }) =>
      api<StyleDefinition>(`/api/v1/style-definitions/${id}`, { method: 'PATCH', body: values }),
    onSuccess: () => {
      setEditor(null)
      queryClient.invalidateQueries({ queryKey: ['styles'] })
    },
  })
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/style-definitions/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['styles'] }),
  })
  const submit = (values: StyleValues) => {
    if (editor?.mode === 'edit') {
      const { key: _key, ...changes } = values
      update.mutate({ id: editor.style.id, values: changes })
    } else if (editor?.mode === 'create') {
      create.mutate(values)
    }
  }
  const editing = create.isPending || update.isPending

  return (
    <div className='page styles-page'>
      <header className='styles-header'>
        <div>
          <span className='styles-eyebrow'>AGENT / EXPRESSION</span>
          <h2>对话设定库</h2>
          <p>0 是该设定的最低程度，1 是最高程度；0 不是关闭。每项都用具体行为说明两端的区别。</p>
        </div>
        <Button type='primary' icon={<PlusOutlined />} aria-label='新增对话设定' onClick={() => setEditor({ mode: 'create' })}>
          新增对话设定
        </Button>
      </header>

      {error && <Alert type='error' showIcon message={`无法读取对话设定：${errorMessage(error)}`} />}
      {isLoading ? (
        <Spin />
      ) : styles.length ? (
        <div className='styles-grid'>
          {styles.map((style) => {
            const version = style.currentVersion
            const guide = styleGuidance(style)
            return (
              <article className='style-card' key={style.id}>
                <div className='style-card-heading'>
                  <div>
                    <span className='style-key'>{style.key}</span>
                    <h3>{version.name}</h3>
                  </div>
                  <Tag color={style.enabled ? 'success' : 'default'}>{style.enabled ? '启用中' : '已停用'}</Tag>
                </div>
                <p className='style-description'>{guide.description}</p>
                <div className='style-scale' aria-label={`${version.name}默认程度 ${version.defaultValue}`}>
                  <span>0 · 最低</span>
                  <b>默认 {version.defaultValue.toFixed(2)}</b>
                  <span>1 · 最高</span>
                  <div className='style-scale-track' aria-hidden='true'>
                    <i style={{ left: `${version.defaultValue * 100}%` }} />
                  </div>
                </div>
                <div className='style-endpoints'>
                  <div>
                    <strong>0 时</strong>
                    <p>{guide.lowDetail}</p>
                  </div>
                  <div>
                    <strong>1 时</strong>
                    <p>{guide.highDetail}</p>
                  </div>
                </div>
                <div className='style-card-actions'>
                  <span>
                    启用{' '}
                    <Switch
                      aria-label={`${version.name}启用`}
                      size='small'
                      checked={style.enabled}
                      loading={toggle.isPending && toggle.variables?.id === style.id}
                      onChange={(enabled) => toggle.mutate({ id: style.id, enabled })}
                    />
                  </span>
                  <div>
                    <Button onClick={() => setDetailId(style.id)}>查看详情</Button>
                    <Button onClick={() => setEditor({ mode: 'edit', style })}>编辑设定</Button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        !error && <Empty description='暂无对话设定，点击“新增对话设定”创建第一项。' />
      )}

      <Modal
        title={editor?.mode === 'edit' ? '编辑对话设定' : '新增对话设定'}
        open={Boolean(editor)}
        width={680}
        okText={editor?.mode === 'edit' ? '保存修改' : '创建设定'}
        okButtonProps={{ loading: editing }}
        onOk={() => form.submit()}
        onCancel={() => {
          if (!editing) setEditor(null)
        }}
        destroyOnHidden
      >
        <p className='style-form-hint'>描述整体作用，再写清 0、0.5、1 时 Agent 具体会怎样表达。修改已有设定会创建新版本。</p>
        <Form form={form} layout='vertical' onFinish={submit} className='style-form'>
          <div className='style-form-pair'>
            <Form.Item
              name='key'
              label='唯一标识'
              rules={[
                { required: true, message: '填写唯一标识' },
                { pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/, message: '以英文字母开头，只使用字母、数字或下划线' },
              ]}
            >
              <Input placeholder='例如 curiosity' maxLength={64} disabled={editor?.mode === 'edit'} />
            </Form.Item>
            <Form.Item name='name' label='名称' rules={[{ required: true, message: '填写设定名称' }]}>
              <Input placeholder='例如 好奇程度' maxLength={64} />
            </Form.Item>
          </div>
          <Form.Item name='description' label='设定说明' rules={[{ required: true, whitespace: true, message: '说明这个设定控制什么' }]}>
            <Input.TextArea rows={2} maxLength={1000} placeholder='例如 控制 Agent 主动追问的程度，不改变回答的准确性。' />
          </Form.Item>
          <Form.Item name='defaultValue' label='默认值' rules={[{ required: true, type: 'number', min: 0, max: 1, message: '填写 0 到 1 的数值' }]}>
            <InputNumber min={0} max={1} step={0.01} style={{ width: 150 }} />
          </Form.Item>
          <div className='style-form-anchors'>
            <Form.Item name='lowText' label='0 · 最低程度' rules={[{ required: true, whitespace: true, message: '说明数值为 0 时的行为' }]}>
              <Input.TextArea rows={2} maxLength={500} placeholder='例如 直接回答，不主动追问。' />
            </Form.Item>
            <Form.Item name='midText' label='0.5 · 中间程度' rules={[{ required: true, whitespace: true, message: '说明数值为 0.5 时的行为' }]}>
              <Input.TextArea rows={2} maxLength={500} placeholder='例如 必要时问一个澄清问题。' />
            </Form.Item>
            <Form.Item name='highText' label='1 · 最高程度' rules={[{ required: true, whitespace: true, message: '说明数值为 1 时的行为' }]}>
              <Input.TextArea rows={2} maxLength={500} placeholder='例如 主动探索对方的意图，但避免连珠追问。' />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={detail ? `${detail.currentVersion.name} · 设定详情` : '设定详情'}
        open={Boolean(detail)}
        width={640}
        onCancel={() => setDetailId(null)}
        footer={[
          <Button key='close' onClick={() => setDetailId(null)}>
            关闭
          </Button>,
          <Button
            key='edit'
            type='primary'
            onClick={() => {
              if (detail) {
                setDetailId(null)
                setEditor({ mode: 'edit', style: detail })
              }
            }}
          >
            编辑设定
          </Button>,
        ]}
      >
        {detail && (
          <div className='style-detail'>
            <p>{styleGuidance(detail).description}</p>
            <div className='style-detail-meta'>
              <span>
                标识 <b>{detail.key}</b>
              </span>
              <span>
                版本 <b>v{detail.currentVersion.version}</b>
              </span>
              <span>
                默认值 <b>{detail.currentVersion.defaultValue.toFixed(2)}</b>
              </span>
            </div>
            {(
              [
                ['0 · 最低程度', detail.currentVersion.lowText, styleGuidance(detail).lowDetail],
                ['0.5 · 中间程度', detail.currentVersion.midText, detail.currentVersion.midText],
                ['1 · 最高程度', detail.currentVersion.highText, styleGuidance(detail).highDetail],
              ] as const
            ).map(([label, anchor, explanation]) => (
              <section key={label} className='style-detail-anchor'>
                <strong>{label}</strong>
                <span>{anchor}</span>
                {explanation !== anchor && <p>{explanation}</p>}
              </section>
            ))}
            <p className='style-detail-note'>Agent 实际使用保存的锚点文字；补充解释只帮助理解数值，不会改动已发布版本。</p>
          </div>
        )}
      </Modal>
    </div>
  )
}
