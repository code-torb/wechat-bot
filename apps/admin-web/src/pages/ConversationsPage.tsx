import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Select, Space, Table, Timeline, Typography, message } from 'antd'
import { useState } from 'react'
import { api } from '../api/client'
import type { Conversation, MessageRow } from '../api/types'

export default function ConversationsPage() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Conversation | null>(null)
  const { data: conversations } = useQuery({
    queryKey: ['conversations', filters],
    queryFn: () =>
      api<Conversation[]>('/api/v1/conversations' + (filters.scene ? `?scene=${filters.scene}` : '')).then((result) => result.data),
  })
  const { data: messages } = useQuery({
    queryKey: ['messages', selected?.id],
    queryFn: () => api<MessageRow[]>(`/api/v1/conversations/${selected!.id}/messages`).then((result) => result.data),
    enabled: Boolean(selected),
  })
  const reset = useMutation({
    mutationFn: (conversationId: string) => api(`/api/v1/conversations/${conversationId}/reset-context`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })
  const remove = useMutation({
    mutationFn: (conversationId: string) => api(`/api/v1/conversations/${conversationId}/messages`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      setSelected(null)
    },
  })
  return (
    <div className="page">
      <h2>会话记录</h2>
      <Space style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="场景"
          style={{ width: 140 }}
          options={[{ value: 'group', label: '群聊' }, { value: 'private', label: '私聊' }]}
          onChange={(value) => setFilters({ ...filters, scene: value })}
        />
        <Input placeholder="发言人 QQ" style={{ width: 180 }} onChange={(event) => setFilters({ ...filters, senderId: event.target.value })} />
      </Space>
      <Table<Conversation>
        rowKey="id"
        dataSource={conversations || []}
        pagination={{ pageSize: 20 }}
        onRow={(row) => ({ onClick: () => setSelected(row), style: { cursor: 'pointer' } })}
        columns={[
          { title: '场景', dataIndex: 'scene', render: (value) => (value === 'group' ? '群聊' : '私聊') },
          { title: '群/好友', dataIndex: 'peerId' },
          { title: '发言人', dataIndex: 'senderId' },
          { title: 'Agent', dataIndex: 'agentId' },
          { title: '上下文段', dataIndex: 'epoch' },
        ]}
      />
      {selected && (
        <div style={{ marginTop: 16 }}>
          <Space>
            <Typography.Text strong>会话 {selected.id}</Typography.Text>
            <Button size="small" onClick={() => reset.mutate(selected.id)}>清除上下文</Button>
            <Button size="small" danger onClick={() => remove.mutate(selected.id)}>删除历史</Button>
          </Space>
          <Timeline style={{ marginTop: 12 }} items={(messages || []).map((row) => ({
            color: row.deliveryStatus === 'sent' ? 'green' : 'gray',
            children: (
              <div>
                <Typography.Text type={row.role === 'user' ? undefined : 'secondary'}>{row.role === 'user' ? '用户' : '机器人'}</Typography.Text>
                <div>{row.text}</div>
                <div className="muted">状态：{row.deliveryStatus}</div>
              </div>
            ),
          }))} />
        </div>
      )}
    </div>
  )
}
