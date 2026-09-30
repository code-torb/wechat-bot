import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Descriptions, Input, InputNumber, Select, Space, Spin, Table, Tabs, Tag, message } from 'antd'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Agent, CommandDefinition, Conversation, StyleDefinition } from '../api/types'
import { styleGuidance } from './styleGuidance'

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
  const { data: defaultRole } = useQuery({
    queryKey: ['default-role-background'],
    queryFn: () => api<{ background: string }>('/api/v1/agents/default-role-background').then((result) => result.data),
    enabled: agent?.name === '默认 Agent' && agent.description === '由旧配置导入',
  })
  const [draft, setDraft] = useState<Agent['draft'] | null>(null)
  useEffect(() => {
    if (agent) setDraft(agent.draft)
  }, [agent])

  const publish = useMutation({
    mutationFn: (edited: Agent['draft']) =>
      api(`/api/v1/agents/${id}/publish`, { method: 'POST', body: { expectedRevision: agent?.revision, draft: edited } }),
    onSuccess: () => {
      message.success('已保存并发布新版本')
      queryClient.invalidateQueries({ queryKey: ['agent', id] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '保存并发布失败'),
  })

  if (isLoading || !agent || !draft) return <Spin style={{ display: 'block', margin: '80px auto' }} />

  const eligibleStyles = (styles || []).filter((style) => style.ownerAgentId === null || style.ownerAgentId === agent.id)
  const availableStyles = eligibleStyles.filter((style) => style.enabled && !draft.styleValues.some((item) => item.definitionId === style.id))
  const canPublish = Boolean(draft.prompt.trim() && draft.model.providerId.trim() && draft.model.credentialRef.trim() && draft.model.name.trim())
  const updateModel = (model: Partial<Agent['draft']['model']>) => setDraft({ ...draft, model: { ...draft.model, ...model } })

  return (
    <div className='page agent-detail-page'>
      <div className='agent-detail-header'>
        <div>
          <span className='agent-detail-eyebrow'>AGENT / 人物档案</span>
          <h2>{agent.name}</h2>
          <Space>
            <Tag>{agent.status}</Tag>
            <Tag>版本修订 {agent.revision}</Tag>
          </Space>
        </div>
        <div className='agent-publish-action'>
          <Button type='primary' onClick={() => publish.mutate(draft)} disabled={!canPublish} loading={publish.isPending}>
            保存并发布
          </Button>
          <span>角色、对话设定、模型与命令一次生效</span>
        </div>
      </div>
      {!canPublish && <p className='agent-publish-hint'>请填写角色背景，以及模型的 Provider ID、凭据引用和模型名后再发布。</p>}
      <Tabs
        items={[
          {
            key: 'role',
            label: '角色与对话',
            children: (
              <Card className='agent-detail-card'>
                <div className='agent-detail-section'>
                  <div className='agent-section-heading'>
                    <div>
                      <h3>角色设定</h3>
                      <p>只写人物的背景故事与经历。说话习惯、情绪和表达程度请在下方的对话设定中调整。</p>
                    </div>
                    {defaultRole && <Button onClick={() => setDraft({ ...draft, prompt: defaultRole.background })}>填入默认人物背景</Button>}
                  </div>
                  <Input.TextArea
                    aria-label='角色设定'
                    rows={9}
                    value={draft.prompt}
                    onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                    placeholder='写下人物的姓名、成长、家庭、工作与人生经历……'
                  />
                </div>
                <div className='agent-detail-section'>
                  <div className='agent-section-heading'>
                    <div>
                      <h3>对话设定</h3>
                      <p>按需添加，只有选中的设定参与对话；不添加时仅使用角色背景。</p>
                    </div>
                  </div>
                  <div className='agent-add-style'>
                    <select
                      aria-label='选择对话设定'
                      className='agent-style-picker'
                      value=''
                      onChange={(event) => {
                        const styleId = event.target.value
                        const style = availableStyles.find((item) => item.id === styleId)
                        if (!style) return
                        setDraft({
                          ...draft,
                          styleValues: [
                            ...draft.styleValues,
                            {
                              definitionId: style.id,
                              definitionVersionId: style.currentVersion.id,
                              value: style.currentVersion.defaultValue,
                            },
                          ],
                        })
                      }}
                    >
                      <option value=''>选择要添加的对话设定</option>
                      {availableStyles.map((style) => (
                        <option key={style.id} value={style.id}>
                          {style.currentVersion.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {draft.styleValues.length === 0 && (
                    <p className='agent-empty-styles'>尚未添加对话设定。可以从上方选择一项，再调整它的 0–1 程度。</p>
                  )}
                  {draft.styleValues.map((selected) => {
                    const style = eligibleStyles.find((item) => item.id === selected.definitionId)
                    const guide = style ? styleGuidance(style) : null
                    return (
                      <div key={selected.definitionId} className='agent-style-setting'>
                        <div>
                          <strong>{style?.currentVersion.name || selected.definitionId}</strong>
                          {!style?.enabled && <Tag color='warning'>已停用或不可用</Tag>}
                          <InputNumber
                            aria-label={`${style?.currentVersion.name || selected.definitionId}取值`}
                            min={0}
                            max={1}
                            step={0.01}
                            value={selected.value}
                            onChange={(value) => {
                              setDraft({
                                ...draft,
                                styleValues: draft.styleValues.map((item) =>
                                  item.definitionId === selected.definitionId ? { ...item, value: Number(value ?? 0) } : item,
                                ),
                              })
                            }}
                          />
                          <Button
                            size='small'
                            danger
                            onClick={() =>
                              setDraft({ ...draft, styleValues: draft.styleValues.filter((item) => item.definitionId !== selected.definitionId) })
                            }
                          >
                            移除
                          </Button>
                        </div>
                        {guide && (
                          <>
                            <small>{guide.description}</small>
                            <div className='agent-style-endpoints'>
                              <span>0：{guide.lowDetail}</span>
                              <span>1：{guide.highDetail}</span>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className='agent-detail-section'>
                  <div className='agent-section-heading'>
                    <div>
                      <h3>回复节奏</h3>
                      <p>基础等待（毫秒）/ 每秒字符数 / 最长等待（毫秒）</p>
                    </div>
                  </div>
                  <Space>
                    <InputNumber
                      aria-label='基础等待毫秒'
                      min={0}
                      max={60000}
                      value={draft.pacing?.baseDelayMs ?? 0}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          pacing: {
                            baseDelayMs: Number(value ?? 0),
                            charsPerSecond: draft.pacing?.charsPerSecond ?? 0,
                            maxDelayMs: draft.pacing?.maxDelayMs ?? 15000,
                          },
                        })
                      }
                    />
                    <InputNumber
                      aria-label='每秒字符数'
                      min={0}
                      max={200}
                      value={draft.pacing?.charsPerSecond ?? 0}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          pacing: {
                            baseDelayMs: draft.pacing?.baseDelayMs ?? 0,
                            charsPerSecond: Number(value ?? 0),
                            maxDelayMs: draft.pacing?.maxDelayMs ?? 15000,
                          },
                        })
                      }
                    />
                    <InputNumber
                      aria-label='最长等待毫秒'
                      min={0}
                      max={60000}
                      value={draft.pacing?.maxDelayMs ?? 15000}
                      onChange={(value) =>
                        setDraft({
                          ...draft,
                          pacing: {
                            baseDelayMs: draft.pacing?.baseDelayMs ?? 0,
                            charsPerSecond: draft.pacing?.charsPerSecond ?? 0,
                            maxDelayMs: Number(value ?? 0),
                          },
                        })
                      }
                    />
                  </Space>
                </div>
              </Card>
            ),
          },
          {
            key: 'model',
            label: '模型',
            children: (
              <Card className='agent-detail-card'>
                <div className='agent-section-heading'>
                  <div>
                    <h3>模型配置</h3>
                    <p>修改后点击页面右上角“保存并发布”，与角色及设定一起生效。</p>
                  </div>
                </div>
                <div className='agent-model-grid'>
                  <label>
                    Provider ID
                    <Input value={draft.model.providerId} onChange={(event) => updateModel({ providerId: event.target.value })} />
                  </label>
                  <label>
                    凭据引用（不显示明文）
                    <Input value={draft.model.credentialRef} onChange={(event) => updateModel({ credentialRef: event.target.value })} />
                  </label>
                  <label>
                    模型名
                    <Input value={draft.model.name} onChange={(event) => updateModel({ name: event.target.value })} />
                  </label>
                  <label>
                    工具调用
                    <Select
                      value={draft.model.supportsTools}
                      onChange={(value) => updateModel({ supportsTools: value })}
                      options={[
                        { value: true, label: '支持' },
                        { value: false, label: '不支持' },
                      ]}
                    />
                  </label>
                </div>
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
                      <Tag color={draft.commandRefs.includes(command.id) ? 'green' : 'default'}>
                        {draft.commandRefs.includes(command.id) ? '已启用' : '未启用'}
                      </Tag>
                      <Button
                        size='small'
                        onClick={() => {
                          const next = draft.commandRefs.includes(command.id)
                            ? draft.commandRefs.filter((ref) => ref !== command.id)
                            : [...draft.commandRefs, command.id]
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
                  rowKey='id'
                  size='small'
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
