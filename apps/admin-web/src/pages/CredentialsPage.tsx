import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Select, Table, Tag, message } from 'antd'
import { api } from '../api/client'
import type { Credential, Provider } from '../api/types'

export default function CredentialsPage() {
  const queryClient = useQueryClient()
  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<Provider[]>('/api/v1/providers').then((result) => result.data),
  })
  const { data: credentials } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api<Credential[]>('/api/v1/credentials').then((result) => result.data),
  })
  const createProvider = useMutation({
    mutationFn: (values: Record<string, unknown>) => api('/api/v1/providers', { method: 'POST', body: values }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  })
  const createCredential = useMutation({
    mutationFn: (values: Record<string, unknown>) => api('/api/v1/credentials', { method: 'POST', body: values }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credentials'] }),
  })
  const testCredential = useMutation({
    mutationFn: (id: string) => api(`/api/v1/credentials/${id}/test`, { method: 'POST', body: {} }),
    onSuccess: () => message.success('凭据可解密，完整性校验通过'),
    onError: (error) => message.error(error instanceof Error ? error.message : '校验失败'),
  })
  return (
    <div className="page">
      <h2>模型与凭据</h2>
      <h3>Provider</h3>
      <Form
        layout="inline"
        style={{ marginBottom: 12 }}
        onFinish={(values) =>
          createProvider.mutate({
            name: values.name,
            baseUrl: values.baseUrl,
            capabilities: values.capabilities ? values.capabilities.split(',') : [],
          })
        }
      >
        <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="名称" /></Form.Item>
        <Form.Item name="baseUrl" rules={[{ required: true }]}><Input placeholder="https://api.example.com/v1" style={{ width: 280 }} /></Form.Item>
        <Form.Item name="capabilities"><Input placeholder="能力，逗号分隔" /></Form.Item>
        <Button htmlType="submit">新增 Provider</Button>
      </Form>
      <Table<Provider>
        rowKey="id"
        size="small"
        dataSource={providers || []}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: 'Base URL', dataIndex: 'baseUrl' },
          { title: '能力', dataIndex: 'capabilities', render: (value: string[]) => value.join(', ') },
        ]}
      />
      <h3 style={{ marginTop: 24 }}>凭据（AES-256-GCM 加密存储，不显示明文）</h3>
      <Form
        layout="inline"
        style={{ marginBottom: 12 }}
        onFinish={(values) => createCredential.mutate({ providerId: values.providerId, purpose: values.purpose, value: values.value })}
      >
        <Form.Item name="providerId" rules={[{ required: true }]}>
          <Select style={{ width: 220 }} placeholder="Provider" options={(providers || []).map((provider) => ({ value: provider.id, label: provider.name }))} />
        </Form.Item>
        <Form.Item name="purpose" initialValue="model">
          <Select style={{ width: 120 }} options={[{ value: 'model', label: '模型' }, { value: 'search', label: '搜索' }]} />
        </Form.Item>
        <Form.Item name="value" rules={[{ required: true }]}><Input.Password placeholder="API Key" style={{ width: 240 }} /></Form.Item>
        <Button htmlType="submit">保存凭据</Button>
      </Form>
      <Table<Credential>
        rowKey="id"
        size="small"
        dataSource={credentials || []}
        columns={[
          { title: '用途', dataIndex: 'purpose' },
          { title: '状态', dataIndex: 'enabled', render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>) },
          { title: '密钥版本', dataIndex: 'keyVersion' },
          { title: '更新时间', dataIndex: 'updatedAt', render: (value: number) => new Date(value).toLocaleString() },
          { title: '操作', render: (_, row) => <Button size="small" onClick={() => testCredential.mutate(row.id)}>校验</Button> },
        ]}
      />
    </div>
  )
}
