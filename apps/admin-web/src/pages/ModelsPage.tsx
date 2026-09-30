import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Modal, Popconfirm, Select, Switch, Table, Tag } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import type { Model } from '../api/types'

type ModelFormValues = {
  name: string
  baseUrl: string
  apiKey?: string
  searchKey?: string
  embeddingModel?: string
  enabled: boolean
}

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const [form] = Form.useForm<ModelFormValues>()
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; model: Model } | null>(null)
  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: () => api<Model[]>('/api/v1/models').then((result) => result.data),
  })
  const save = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      if (editor?.mode === 'edit') {
        await api(`/api/v1/models/${editor.model.id}`, { method: 'PATCH', body: values })
        return
      }
      await api('/api/v1/models', { method: 'POST', body: values })
    },
    onSuccess: () => {
      setEditor(null)
      form.resetFields()
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/models/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  })
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/models/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  })
  const test = useMutation({
    mutationFn: (id: string) => api(`/api/v1/models/${id}/test`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  })
  return (
    <div className='page'>
      <h2>模型</h2>
      <p className='muted'>每个模型包含 Base URL、唯一标识和 API Key；搜索 Key 与嵌入模型名可选。</p>
      <Button type='primary' style={{ marginBottom: 12 }} onClick={() => setEditor({ mode: 'create' })}>
        新建模型
      </Button>
      <Table<Model>
        rowKey='id'
        size='small'
        dataSource={models || []}
        columns={[
          { title: '唯一标识', dataIndex: 'name' },
          { title: 'Base URL', dataIndex: 'baseUrl' },
          { title: '嵌入模型', dataIndex: 'embeddingModel', render: (value: string) => value || '-' },
          { title: '搜索 Key', dataIndex: 'hasSearchKey', render: (value: boolean) => (value ? '已配置' : '-') },
          {
            title: '状态',
            dataIndex: 'enabled',
            render: (value: boolean, row) => (
              <Switch checked={value} size='small' onChange={(checked) => toggle.mutate({ id: row.id, enabled: checked })} />
            ),
          },
          { title: '更新时间', dataIndex: 'updatedAt', render: (value: number) => new Date(value).toLocaleString() },
          {
            title: '操作',
            render: (_, row) => (
              <>
                <Button
                  size='small'
                  onClick={() => {
                    form.setFieldsValue({ name: row.name, baseUrl: row.baseUrl, embeddingModel: row.embeddingModel, enabled: row.enabled })
                    setEditor({ mode: 'edit', model: row })
                  }}
                >
                  编辑
                </Button>
                <Button size='small' style={{ marginLeft: 6 }} onClick={() => test.mutate(row.id)} loading={test.isPending}>
                  校验
                </Button>
                <Popconfirm title='确认删除该模型？' description='仍被 Agent 使用的模型无法删除。' onConfirm={() => remove.mutate(row.id)}>
                  <Button size='small' danger style={{ marginLeft: 6 }}>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ),
          },
        ]}
      />
      <Modal
        title={editor?.mode === 'edit' ? '编辑模型' : '新建模型'}
        open={editor !== null}
        onCancel={() => setEditor(null)}
        onOk={() => form.submit()}
        okText={editor?.mode === 'edit' ? '保存修改' : '创建模型'}
        confirmLoading={save.isPending}
      >
        <Form
          form={form}
          layout='vertical'
          initialValues={{ enabled: true }}
          onFinish={(values) =>
            save.mutate({ ...values, apiKey: values.apiKey || '', searchKey: values.searchKey || '', embeddingModel: values.embeddingModel || '' })
          }
        >
          <Form.Item name='name' label='唯一标识' rules={[{ required: true, message: '填写唯一标识' }]}>
            <Input placeholder='如 deepseek' disabled={editor?.mode === 'edit'} />
          </Form.Item>
          <Form.Item name='baseUrl' label='Base URL' rules={[{ required: true, message: '填写 Base URL' }]}>
            <Input placeholder='https://api.deepseek.com/v1' />
          </Form.Item>
          <Form.Item
            name='apiKey'
            label={editor?.mode === 'edit' ? 'API Key（留空表示不修改）' : 'API Key'}
            rules={[{ required: editor?.mode !== 'edit', message: '填写 API Key' }]}
          >
            <Input.Password placeholder='sk-...' />
          </Form.Item>
          <Form.Item name='searchKey' label='搜索 API Key（可选）'>
            <Input.Password placeholder='用于联网搜索，可留空' />
          </Form.Item>
          <Form.Item name='embeddingModel' label='嵌入模型名（可选）'>
            <Input placeholder='如 text-embedding-3-small' />
          </Form.Item>
          <Form.Item name='enabled' label='启用' valuePropName='checked'>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
