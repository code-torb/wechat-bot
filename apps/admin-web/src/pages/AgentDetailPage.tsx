import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Spin, Table, Tabs, Tag, message } from 'antd'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Agent, CommandDefinition, Conversation, StyleDefinition } from '../api/types'

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api<Agent>(`/api/v1/agents/${id}`).then((result) => result.data),
  })
  const { data: styles } = useQuery({
    queryKey: ['styles'],
    queryFn: () => api<StyleDefinition[]>('/api/v1/style-definitions').then((result) => result.data),
  })
  const { data: commands } = useQuery({
    queryKey: ['commands'],
    queryFn: () => api<CommandDefinition[]>('/api/v1/commands').then((result) => result.data),
  })
  const { data: conversations } = useQuery({
    queryKey: ['conversations', id],
    queryFn: () => api<Conversation[]>(`/api/v1/conversations?agentId=${id}`).then((result) => result.data),
  })
  const [draft, setDraft] = useState<Agent['draft'] | null>(null)
  useEffect(() => {
    if (agent) setDraft(agent.draft)
  }, [agent])

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/api/v1/agents/${id}`, { method: 'PATCH', body, headers: { 'if-match': String(agent?.revision) } }),
    onSuccess: () => {
      message.success('草稿已保存')
      queryClient.invalidateQueries({ queryKey: ['agent', id] })
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '保存失败'),
  })
  const publish = useMutation({
    mutationFn: () => api(`/api/v1/agents/${id}/publish`, { method: 'POST', body: { expectedRevision: agent?.revision } }),
    onSuccess: () => {
      message.success('已发布新版本')
      queryClient.invalidateQueries({ queryKey: ['agent', id] })
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '发布失败'),
  })

  if (isLoading || !agent || !draft) return <Spin style={{ display: 'block', margin: '80px auto' }} />

  const modelForm = {
    providerId: draft.model.providerId,
    credentialRef: draft.model.credentialRef,
    modelName: draft.model.name,
    supportsTools: draft.model.supportsTools,
  }

  return (
    <div className="page">
      <Space style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{agent.name}</h2>
        <Tag>{agent.status}</Tag>
        <Tag>revision {agent.revision}</Tag>
        <Button onClick={() => publish.mutate()} loading={publish.isPending}>发布版本</Button>
      </Space>
      <Tabs
        items={[
          {
            key: 'role',
            label: '角色与对话',
            children: (
              <Card>
                <Form
                  layout="vertical"
                  initialValues={{ ...modelForm }}
                  onFinish={(values) => save.mutate({ model: { ...values } })}
                >
                  <Form.Item label="Prompt" required>
                    <Input.TextArea
                      rows={8}
                      value={draft.prompt}
                      onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                      placeholder="角色、背景、关系设定、领域与原则"
                    />
                  </Form.Item>
                  <Form.Item label="对话设定">
                    {styles?.map((style) => {
                      const selected = draft.styleValues.find((item) => item.definitionVersionId === style.currentVersion.id)
                      return (
                        <div key={style.id} style={{ marginBottom: 8 }}>
                          <span style={{ display: 'inline-block', width: 140 }}>{style.currentVersion.name}</span>
                          <InputNumber
                            min={0}
                            max={1}
                            step={0.01}
                            value={selected?.value ?? style.currentVersion.defaultValue}
                            onChange={(value) => {
                              const others = draft.styleValues.filter((item) => item.definitionVersionId !== style.currentVersion.id)
                              setDraft({
                                ...draft,
                                styleValues: [...others, { definitionVersionId: style.currentVersion.id, value: Number(value ?? 0) }],
                              })
                            }}
                          />
                          <span className="muted" style={{ marginLeft: 8 }}>{style.currentVersion.description}</span>
                        </div>
                      )
                    })}
                  </Form.Item>
                  <Form.Item label="回复节奏（毫秒 / 字符每秒 / 上限）">
                    <Space>
                      <InputNumber
                        min={0}
                        max={60000}
                        value={draft.pacing?.baseDelayMs ?? 0}
                        onChange={(value) => setDraft({ ...draft, pacing: { baseDelayMs: Number(value ?? 0), charsPerSecond: draft.pacing?.charsPerSecond ?? 0, maxDelayMs: draft.pacing?.maxDelayMs ?? 15000 } })}
                      />
                      <InputNumber
                        min={0}
                        max={200}
                        value={draft.pacing?.charsPerSecond ?? 0}
                        onChange={(value) => setDraft({ ...draft, pacing: { baseDelayMs: draft.pacing?.baseDelayMs ?? 0, charsPerSecond: Number(value ?? 0), maxDelayMs: draft.pacing?.maxDelayMs ?? 15000 } })}
                      />
                      <InputNumber
                        min={0}
                        max={60000}
                        value={draft.pacing?.maxDelayMs ?? 15000}
                        onChange={(value) => setDraft({ ...draft, pacing: { baseDelayMs: draft.pacing?.baseDelayMs ?? 0, charsPerSecond: draft.pacing?.charsPerSecond ?? 0, maxDelayMs: Number(value ?? 0) } })}
                      />
                    </Space>
                  </Form.Item>
                  <Button onClick={() => save.mutate({ prompt: draft.prompt, styleValues: draft.styleValues, pacing: draft.pacing })} loading={save.isPending}>
                    保存草稿
                  </Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'model',
            label: '模型',
            children: (
              <Card>
                <Form
                  layout="vertical"
                  onFinish={(values) => save.mutate({ model: { providerId: values.providerId, credentialRef: values.credentialRef, name: values.modelName, supportsTools: values.supportsTools } })}
                  initialValues={modelForm}
                >
                  <Form.Item name="providerId" label="Provider ID" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="credentialRef" label="凭据引用（不显示明文）" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="modelName" label="模型名" rules={[{ required: true }]}><Input /></Form.Item>
                  <Form.Item name="supportsTools" label="支持工具调用"><Select options={[{ value: true, label: '支持' }, { value: false, label: '不支持' }]} /></Form.Item>
                  <Button htmlType="submit" loading={save.isPending}>保存模型</Button>
                </Form>
              </Card>
            ),
          },
          {
            key: 'commands',
            label: '命令',
            children: (
              <Card>
                <Descriptions column={1}>
                  {commands?.map((command) => (
                    <Descriptions.Item key={command.id} label={command.name}>
                      <Tag color={draft.commandRefs.includes(command.id) ? 'green' : 'default'}>{draft.commandRefs.includes(command.id) ? '已启用' : '未启用'}</Tag>
                      <Button
                        size="small"
                        onClick={() => {
                          const next = draft.commandRefs.includes(command.id)
                            ? draft.commandRefs.filter((ref) => ref !== command.id)
                            : [...draft.commandRefs, command.id]
                          save.mutate({ commandRefs: next, prompt: draft.prompt, styleValues: draft.styleValues, pacing: draft.pacing })
                          setDraft({ ...draft, commandRefs: next })
                        }}
                      >
                        切换
                      </Button>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </Card>
            ),
          },
          {
            key: 'sessions',
            label: '会话',
            children: (
              <Card>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={conversations || []}
                  columns={[
                    { title: '场景', dataIndex: 'scene' },
                    { title: '群/好友', dataIndex: 'peerId' },
                    { title: '发言人', dataIndex: 'senderId' },
                    { title: '上下文段', dataIndex: 'epoch' },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  )
}
