import { useQuery } from '@tanstack/react-query'
import { Table } from 'antd'
import { api } from '../api/client'
import type { AuditEvent } from '../api/types'

export default function AuditPage() {
  const { data } = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<AuditEvent[]>('/api/v1/audit-events').then((result) => result.data),
  })
  return (
    <div className="page">
      <h2>审计</h2>
      <Table<AuditEvent>
        rowKey="id"
        size="small"
        dataSource={data || []}
        columns={[
          { title: '时间', dataIndex: 'createdAt', render: (value: number) => new Date(value).toLocaleString() },
          { title: '操作人', render: (_, row) => `${row.actorType}:${row.actorId}` },
          { title: '动作', dataIndex: 'action' },
          { title: '资源', dataIndex: 'resourceType' },
          { title: '资源 ID', dataIndex: 'resourceId' },
          { title: '结果', dataIndex: 'result' },
        ]}
      />
    </div>
  )
}
