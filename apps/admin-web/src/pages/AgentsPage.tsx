import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Space, Table, Tag, Input, message } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Agent } from '../api/types'

export default function AgentsPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api<Agent[]>('/api/v1/agents').then((result) => result.data),
  })
  const create = useMutation({
    mutationFn: async () => {
      const result = await api<Agent>('/api/v1/agents', { method: 'POST', body: { name: name.trim() } })
      return result.data
    },
    onSuccess: (result) => {
      setName('')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      navigate(`/agents/${result.id}`)
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '创建失败'),
  })
  return (
    <div className="page">
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder="名称" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>新建 Agent</Button>
      </Space>
      <Table<Agent>
        rowKey="id"
        dataSource={data || []}
        onRow={(row) => ({ onClick: () => navigate(`/agents/${row.id}`), style: { cursor: 'pointer' } })}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '状态', dataIndex: 'status', render: (status: Agent['status']) => <Tag>{status}</Tag> },
          { title: '模型', render: (_, row) => row.draft?.model?.name || '未配置' },
          { title: '版本', dataIndex: 'revision' },
          { title: '已发布', dataIndex: 'publishedVersionId', render: (value) => (value ? '是' : '否') },
        ]}
      />
    </div>
  )
}
