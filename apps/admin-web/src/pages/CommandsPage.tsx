import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, Select, Table, message } from 'antd'
import { api } from '../api/client'
import type { CommandDefinition } from '../api/types'

export default function CommandsPage() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['commands'],
    queryFn: () => api<CommandDefinition[]>('/api/v1/commands').then((result) => result.data),
  })
  const create = useMutation({
    mutationFn: (values: Record<string, unknown>) => api('/api/v1/commands', { method: 'POST', body: values }),
    onSuccess: () => {
      message.success('命令已创建')
      queryClient.invalidateQueries({ queryKey: ['commands'] })
    },
  })
  return (
    <div className="page">
      <h2>命令模板</h2>
      <Form
        layout="inline"
        style={{ marginBottom: 12 }}
        onFinish={(values) =>
          create.mutate({
            name: values.name,
            aliases: values.aliases ? values.aliases.split(',') : [],
            executionType: values.executionType,
            steps: values.steps ? JSON.parse(values.steps) : [],
            capabilities: values.capabilities ? values.capabilities.split(',') : [],
          })
        }
      >
        <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="命令名，如 translate" /></Form.Item>
        <Form.Item name="aliases"><Input placeholder="别名，逗号分隔" /></Form.Item>
        <Form.Item name="executionType" initialValue="static"><Select style={{ width: 150 }} options={[{ value: 'static', label: '固定回复' }, { value: 'model_task', label: '模型任务' }, { value: 'workflow', label: '工作流' }]} /></Form.Item>
        <Form.Item name="steps"><Input placeholder='[{"text":"..."}] 或 [{"template":"..."}]' /></Form.Item>
        <Form.Item name="capabilities"><Input placeholder="所需能力，逗号分隔" /></Form.Item>
        <Button type="primary" htmlType="submit">创建命令</Button>
      </Form>
      <Table<CommandDefinition>
        rowKey="id"
        dataSource={data || []}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '别名', dataIndex: 'aliases', render: (value: string[]) => value.join(', ') },
          { title: '类型', dataIndex: 'executionType' },
          { title: '能力', dataIndex: 'capabilities', render: (value: string[]) => value.join(', ') },
        ]}
      />
    </div>
  )
}
