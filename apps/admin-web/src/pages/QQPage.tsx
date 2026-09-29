import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, InputNumber, Select, Space, Table, Tag, message } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import type { AccessRule, Agent, Binding } from '../api/types'

export default function QQPage() {
  const queryClient = useQueryClient()
  const [accountId, setAccountId] = useState('')
  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<Agent[]>('/api/v1/agents').then((result) => result.data),
  })
  const { data: rules } = useQuery({
    queryKey: ['qq-rules', accountId],
    queryFn: () => api<AccessRule[]>(`/api/v1/qq/accounts/${accountId}/access-rules`).then((result) => result.data),
    enabled: Boolean(accountId),
  })
  const { data: bindings } = useQuery({
    queryKey: ['qq-bindings', accountId],
    queryFn: () => api<Binding[]>(`/api/v1/qq/accounts/${accountId}/bindings`).then((result) => result.data),
    enabled: Boolean(accountId),
  })
  const saveRules = useMutation({
    mutationFn: (rules: AccessRule[]) => api(`/api/v1/qq/accounts/${accountId}/access-rules`, { method: 'PUT', body: { rules } }),
    onSuccess: () => {
      message.success('规则已保存')
      queryClient.invalidateQueries({ queryKey: ['qq-rules', accountId] })
    },
  })
  const [preview, setPreview] = useState<{ accepted: boolean; reason: string; agentId?: string | null; maxLevel?: number | null } | null>(null)
  return (
    <div className="page">
      <h2>QQ 接入与权限</h2>
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder="QQ 账号 ID（管理台中的 bot_accounts id）" value={accountId} onChange={(event) => setAccountId(event.target.value)} style={{ width: 300 }} />
      </Space>
      <Table<AccessRule>
        rowKey="id"
        dataSource={rules || []}
        pagination={false}
        columns={[
          { title: '场景', dataIndex: 'scopeType' },
          { title: '群/用户', dataIndex: 'scopeKey' },
          { title: '允许', dataIndex: 'allow', render: (value: boolean) => (value ? <Tag color="green">允许</Tag> : <Tag>拒绝</Tag>) },
          { title: '触发', render: (_, row) => JSON.stringify(row.trigger) },
          { title: '权限上限', dataIndex: 'maxLevel' },
          { title: '引用回复', dataIndex: 'quoteReply', render: (value: boolean) => (value ? '是' : '否') },
        ]}
      />
      <Table<Binding>
        rowKey="id"
        dataSource={bindings || []}
        style={{ marginTop: 16 }}
        pagination={false}
        columns={[
          { title: '场景', dataIndex: 'scope_type' },
          { title: '作用域', dataIndex: 'scope_key' },
          { title: 'Agent', dataIndex: 'agent_id' },
        ]}
      />
      <Form
        layout="inline"
        style={{ margin: '16px 0' }}
        onFinish={(values) => {
          const next = [...(rules || []).filter((rule) => !(rule.scopeType === values.scopeType && rule.scopeKey === values.scopeKey)), { ...values }]
          saveRules.mutate(next)
        }}
      >
        <Form.Item name="scopeType" initialValue="group"><Select style={{ width: 120 }} options={[{ value: 'group', label: '群' }, { value: 'private', label: '私聊' }, { value: 'group_user', label: '群内用户' }]} /></Form.Item>
        <Form.Item name="scopeKey" rules={[{ required: true }]}><Input placeholder="群号/QQ号 或 群号:QQ号" /></Form.Item>
        <Form.Item name="allow" initialValue={true}><Select style={{ width: 100 }} options={[{ value: true, label: '允许' }, { value: false, label: '拒绝' }]} /></Form.Item>
        <Form.Item name="trigger" initialValue={{ mode: 'any', mention: true }}><Input placeholder='{"mode":"any","mention":true,"prefix":"小助手"}' /></Form.Item>
        <Form.Item name="maxLevel" initialValue={0}><InputNumber min={0} max={3} /></Form.Item>
        <Button type="primary" htmlType="submit">新增规则</Button>
      </Form>
      <Form
        layout="inline"
        style={{ marginBottom: 16 }}
        onFinish={async (values) => {
          const result = await api<{ accepted: boolean; reason: string; agentId?: string | null; maxLevel?: number | null }>(
            `/api/v1/qq/accounts/${accountId}/route-preview`,
            { method: 'POST', body: { scene: values.scene, peerId: values.peerId, senderId: values.senderId, text: values.text, mentionedSelf: values.mentionedSelf === 'true' } },
          )
          setPreview(result.data)
        }}
      >
        <Form.Item name="scene" initialValue="group"><Select style={{ width: 100 }} options={[{ value: 'group', label: '群' }, { value: 'private', label: '私聊' }]} /></Form.Item>
        <Form.Item name="peerId" rules={[{ required: true }]}><Input placeholder="群号/QQ号" /></Form.Item>
        <Form.Item name="senderId" rules={[{ required: true }]}><Input placeholder="发言人 QQ" /></Form.Item>
        <Form.Item name="text" rules={[{ required: true }]}><Input placeholder="消息内容" /></Form.Item>
        <Form.Item name="mentionedSelf" initialValue="true"><Select style={{ width: 110 }} options={[{ value: 'true', label: '已 @' }, { value: 'false', label: '未 @' }]} /></Form.Item>
        <Button htmlType="submit">路由预览</Button>
      </Form>
      {preview && <Alert type={preview.accepted ? 'success' : 'warning'} message={`${preview.accepted ? '允许' : '拒绝'}：${preview.reason}${preview.agentId ? `，Agent ${preview.agentId}` : ''}${preview.maxLevel != null ? `，权限上限 L${preview.maxLevel}` : ''}`} />}
    </div>
  )
}
