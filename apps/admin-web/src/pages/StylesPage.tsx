import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, InputNumber, Space, Table, Switch, Tag, message } from 'antd'
import { api } from '../api/client'
import type { StyleDefinition } from '../api/types'

export default function StylesPage() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['styles'],
    queryFn: () => api<StyleDefinition[]>('/api/v1/style-definitions').then((result) => result.data),
  })
  const create = useMutation({
    mutationFn: (values: Record<string, unknown>) => api('/api/v1/style-definitions', { method: 'POST', body: values }),
    onSuccess: () => {
      message.success('已创建设定')
      queryClient.invalidateQueries({ queryKey: ['styles'] })
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '创建失败'),
  })
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api(`/api/v1/style-definitions/${id}`, { method: 'PATCH', body: { enabled } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['styles'] }),
  })
  return (
    <div className="page">
      <h2>对话设定库</h2>
      <Form
        layout="inline"
        style={{ marginBottom: 12 }}
        onFinish={(values) =>
          create.mutate({
            key: values.key,
            name: values.name,
            defaultValue: values.defaultValue,
            lowText: values.lowText,
            midText: values.midText,
            highText: values.highText,
          })
        }
      >
        <Form.Item name="key" rules={[{ required: true }]}><Input placeholder="唯一标识，如 curiosity" style={{ width: 180 }} /></Form.Item>
        <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="名称" /></Form.Item>
        <Form.Item name="defaultValue" initialValue={0.5}><InputNumber min={0} max={1} step={0.01} /></Form.Item>
        <Form.Item name="lowText" rules={[{ required: true }]}><Input placeholder="0 的含义" /></Form.Item>
        <Form.Item name="midText" rules={[{ required: true }]}><Input placeholder="0.5 的含义" /></Form.Item>
        <Form.Item name="highText" rules={[{ required: true }]}><Input placeholder="1 的含义" /></Form.Item>
        <Button type="primary" htmlType="submit" loading={create.isPending}>新增设定</Button>
      </Form>
      <Table<StyleDefinition>
        rowKey="id"
        dataSource={data || []}
        columns={[
          { title: '名称', dataIndex: ['currentVersion', 'name'] },
          { title: '标识', dataIndex: 'key' },
          { title: '默认值', dataIndex: ['currentVersion', 'defaultValue'] },
          { title: '0 含义', dataIndex: ['currentVersion', 'lowText'] },
          { title: '0.5 含义', dataIndex: ['currentVersion', 'midText'] },
          { title: '1 含义', dataIndex: ['currentVersion', 'highText'] },
          {
            title: '启用',
            render: (_, row) => (
              <Switch checked={row.enabled} onChange={(enabled) => toggle.mutate({ id: row.id, enabled })} />
            ),
          },
        ]}
      />
    </div>
  )
}
