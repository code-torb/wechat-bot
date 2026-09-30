import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Descriptions, Input, InputNumber, Select, Space, Spin, Table, Tabs, Tag, message } from 'antd'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Agent, AgentRelation, CommandDefinition, Conversation, KnowledgeDoc, Model, StyleDefinition } from '../api/types'
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
  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: () => api<Model[]>('/api/v1/models').then((result) => result.data),
  })
  const { data: conversations } = useQuery({
    queryKey: ['conversations', id],
    queryFn: () => api<Conversation[]>(`/api/v1/conversations?agentId=${id}`).then((result) => result.data),
  })
  const { data: relations } = useQuery({
    queryKey: ['relations', id],
    queryFn: () => api<AgentRelation[]>(`/api/v1/agents/${id}/relations`).then((result) => result.data),
  })
  const { data: knowledgeDocs } = useQuery({
    queryKey: ['knowledge-docs', id],
    queryFn: () => api<KnowledgeDoc[]>(`/api/v1/agents/${id}/knowledge-docs`).then((result) => result.data),
  })
  const { data: defaultRole } = useQuery({
    queryKey: ['default-role-background'],
    queryFn: () => api<{ background: string }>('/api/v1/agents/default-role-background').then((result) => result.data),
    enabled: agent?.name === '默认 Agent' && agent.description === '由旧配置导入',
  })
  const [draft, setDraft] = useState<Agent['draft'] | null>(null)
  const [relationForm, setRelationForm] = useState({ personName: '', relation: '' })
  const [knowledgeForm, setKnowledgeForm] = useState({ title: '', base64: '', fileName: '' })
  const [activeTab, setActiveTab] = useState('role')
  const [fieldErrors, setFieldErrors] = useState<{ prompt?: string; modelId?: string; modelName?: string }>({})
  useEffect(() => {
    if (agent) setDraft(agent.draft)
  }, [agent])

  const publish = useMutation({
    mutationFn: (edited: Agent['draft']) =>
      api(`/api/v1/agents/${id}/publish`, { method: 'POST', body: { expectedRevision: agent?.revision, draft: edited } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', id] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const addRelation = useMutation({
    mutationFn: () => api<AgentRelation>(`/api/v1/agents/${id}/relations`, { method: 'POST', body: relationForm }),
    onSuccess: () => {
      setRelationForm({ personName: '', relation: '' })
      queryClient.invalidateQueries({ queryKey: ['relations', id] })
    },
  })
  const refreshRelation = useMutation({
    mutationFn: (relationId: string) => api(`/api/v1/agents/${id}/relations/${relationId}/refresh`, { method: 'POST', body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relations', id] })
    },
  })
  const refreshAll = useMutation({
    mutationFn: () => api<{ updated: number }>(`/api/v1/agents/${id}/relations/refresh-all`, { method: 'POST', body: {} }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relations', id] })
    },
  })
  const removeRelation = useMutation({
    mutationFn: (relationId: string) => api(`/api/v1/agents/${id}/relations/${relationId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relations', id] })
    },
  })

  const uploadKnowledge = useMutation({
    mutationFn: async () => {
      const title = knowledgeForm.title.trim() || knowledgeForm.fileName.replace(/\.txt$/i, '') || '未命名资料'
      const result = await api<KnowledgeDoc>(`/api/v1/agents/${id}/knowledge-docs`, {
        method: 'POST',
        body: { title, dataBase64: knowledgeForm.base64 },
      })
      return result.data
    },
    onSuccess: () => {
      setKnowledgeForm({ title: '', base64: '', fileName: '' })
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs', id] })
    },
  })
  const removeKnowledge = useMutation({
    mutationFn: (docId: string) => api(`/api/v1/agents/${id}/knowledge-docs/${docId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-docs', id] })
    },
  })

  if (isLoading || !agent || !draft) return <Spin style={{ display: 'block', margin: '80px auto' }} />

  const eligibleStyles = (styles || []).filter((style) => style.ownerAgentId === null || style.ownerAgentId === agent.id)
  const availableStyles = eligibleStyles.filter((style) => style.enabled && !draft.styleValues.some((item) => item.definitionId === style.id))
  const modelId = draft.model?.modelId?.trim() || (draft.model as { providerId?: string }).providerId?.trim() || ''
  const handlePublish = () => {
    const errors: { prompt?: string; modelId?: string; modelName?: string } = {}
    if (!draft.prompt.trim()) errors.prompt = '请填写角色背景故事'
    if (!modelId) errors.modelId = '请选择一个模型'
    if (!draft.model?.name?.trim()) errors.modelName = '请填写模型名'
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      setActiveTab(errors.prompt ? 'role' : 'model')
      message.warning('还有必填项未填写，请补充后重试')
      return
    }
    publish.mutate(draft)
  }
  const updateModel = (model: Partial<Agent['draft']['model']>) => setDraft({ ...draft, model: { ...draft.model, ...model } })
  const updateAttributes = (attributes: Partial<Agent['draft']['attributes']>) =>
    setDraft({ ...draft, attributes: { ...(draft.attributes || {}), ...attributes } })

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
          <Button type='primary' onClick={handlePublish} loading={publish.isPending}>
            保存并发布
          </Button>
          <span>角色、对话设定、模型与命令一次生效</span>
        </div>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'role',
            label: '角色与对话',
            children: (
              <Card className='agent-detail-card'>
                <div className='agent-detail-section'>
                  <div className='agent-section-heading'>
                    <div>
                      <h3>基本信息</h3>
                      <p>姓名、出生日期、性别、职业、爱好等属性单独填写；背景故事只写生活经历。</p>
                    </div>
                  </div>
                  <div className='agent-attribute-grid'>
                    <label>
                      姓名
                      <Input
                        aria-label='角色姓名'
                        value={draft.attributes?.name ?? ''}
                        onChange={(event) => updateAttributes({ name: event.target.value })}
                      />
                    </label>
                    <label>
                      出生日期
                      <Input
                        aria-label='出生日期'
                        placeholder='例如 1988-05-06'
                        value={draft.attributes?.birthDate ?? ''}
                        onChange={(event) => updateAttributes({ birthDate: event.target.value })}
                      />
                    </label>
                    <label>
                      性别
                      <Input
                        aria-label='性别'
                        value={draft.attributes?.gender ?? ''}
                        onChange={(event) => updateAttributes({ gender: event.target.value })}
                      />
                    </label>
                    <label>
                      职业
                      <Input
                        aria-label='职业'
                        value={draft.attributes?.occupation ?? ''}
                        onChange={(event) => updateAttributes({ occupation: event.target.value })}
                      />
                    </label>
                    <label>
                      爱好
                      <Input
                        aria-label='爱好'
                        value={draft.attributes?.hobbies ?? ''}
                        onChange={(event) => updateAttributes({ hobbies: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
                <div className='agent-detail-section'>
                  <div className='agent-section-heading'>
                    <div>
                      <h3>角色设定</h3>
                      <p>只写人物的生活经历与故事。说话习惯、情绪和表达程度请在下方的对话设定中调整。</p>
                    </div>
                    {defaultRole && <Button onClick={() => setDraft({ ...draft, prompt: defaultRole.background })}>填入默认人物背景</Button>}
                  </div>
                  <Input.TextArea
                    aria-label='角色设定'
                    rows={9}
                    value={draft.prompt}
                    onChange={(event) => {
                      setDraft({ ...draft, prompt: event.target.value })
                      if (fieldErrors.prompt) setFieldErrors((prev) => ({ ...prev, prompt: undefined }))
                    }}
                    placeholder='写下人物的生活经历与故事，例如成长、家庭、工作后的经历……'
                  />
                  {fieldErrors.prompt && <p className='field-error'>{fieldErrors.prompt}</p>}
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
            key: 'relations',
            label: '人物关系',
            children: (
              <Card className='agent-detail-card'>
                <div className='agent-section-heading'>
                  <div>
                    <h3>人物关系</h3>
                    <p>
                      为每个相关人物建立独立的关系文档。对话时角色会带上这些关系，对方只要说明自己是谁即可。每 12 小时自动更新，也可用 /refresh
                      命令或下方按钮手动更新。
                    </p>
                  </div>
                  <Button onClick={() => refreshAll.mutate()} loading={refreshAll.isPending}>
                    全部更新
                  </Button>
                </div>
                <div className='agent-relation-form'>
                  <Input
                    aria-label='人物名称'
                    placeholder='人物名称'
                    value={relationForm.personName}
                    onChange={(event) => setRelationForm({ ...relationForm, personName: event.target.value })}
                  />
                  <Input.TextArea
                    aria-label='关系简介'
                    rows={2}
                    placeholder='关系简介（可选，更新时由模型扩展成关系上下文）'
                    value={relationForm.relation}
                    onChange={(event) => setRelationForm({ ...relationForm, relation: event.target.value })}
                  />
                  <Button
                    type='primary'
                    disabled={!relationForm.personName.trim()}
                    loading={addRelation.isPending}
                    onClick={() => addRelation.mutate()}
                  >
                    添加人物
                  </Button>
                </div>
                {relations?.length === 0 && <p className='agent-empty-styles'>还没有人物关系。先添加一个人物，再点“更新”生成关系上下文。</p>}
                {relations?.map((rel) => (
                  <div key={rel.id} className='agent-relation-row'>
                    <div className='agent-relation-head'>
                      <strong>{rel.personName}</strong>
                      <span>{rel.relation || '未填写简介'}</span>
                    </div>
                    {rel.contextDoc ? (
                      <p className='agent-relation-doc'>{rel.contextDoc}</p>
                    ) : (
                      <p className='muted'>尚未生成关系上下文，点击“更新”生成。</p>
                    )}
                    <div className='agent-relation-meta'>
                      <span>更新于 {new Date(rel.updatedAt).toLocaleString()}</span>
                      <Button size='small' onClick={() => refreshRelation.mutate(rel.id)} loading={refreshRelation.isPending}>
                        更新
                      </Button>
                      <Button size='small' danger onClick={() => removeRelation.mutate(rel.id)} loading={removeRelation.isPending}>
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
              </Card>
            ),
          },
          {
            key: 'knowledge',
            label: '知识库',
            children: (
              <Card className='agent-detail-card'>
                <div className='agent-section-heading'>
                  <div>
                    <h3>知识库</h3>
                    <p>上传 txt 文本作为角色的背景资料。对话时按最新资料节选注入，帮助角色了解自己的过往。</p>
                  </div>
                </div>
                <div className='agent-knowledge-form'>
                  <Input
                    aria-label='资料标题'
                    placeholder='资料标题'
                    value={knowledgeForm.title}
                    onChange={(event) => setKnowledgeForm({ ...knowledgeForm, title: event.target.value })}
                  />
                  <input
                    aria-label='选择文本文件'
                    type='file'
                    accept='.txt,text/plain'
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = () => {
                        const dataUrl = String(reader.result || '')
                        setKnowledgeForm({ ...knowledgeForm, base64: dataUrl.split(',')[1] || '', fileName: file.name })
                      }
                      reader.readAsDataURL(file)
                    }}
                  />
                  <Button
                    type='primary'
                    disabled={!knowledgeForm.base64}
                    loading={uploadKnowledge.isPending}
                    onClick={() => uploadKnowledge.mutate()}
                  >
                    上传文本
                  </Button>
                </div>
                {knowledgeDocs?.map((doc) => (
                  <div key={doc.id} className='agent-knowledge-row'>
                    <div>
                      <strong>{doc.title}</strong>
                      <span className='muted'>
                        {doc.chars} 字 · {new Date(doc.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <Button size='small' danger onClick={() => removeKnowledge.mutate(doc.id)} loading={removeKnowledge.isPending}>
                      删除
                    </Button>
                  </div>
                ))}
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
                    模型
                    <Select
                      value={modelId || undefined}
                      placeholder='选择模型'
                      options={(models || []).filter((model) => model.enabled).map((model) => ({ value: model.id, label: model.name }))}
                      onChange={(value) => {
                        updateModel({ modelId: value })
                        if (fieldErrors.modelId) setFieldErrors((prev) => ({ ...prev, modelId: undefined }))
                      }}
                    />
                    {fieldErrors.modelId && <p className='field-error'>{fieldErrors.modelId}</p>}
                  </label>
                  <label>
                    模型名
                    <Input
                      value={draft.model.name}
                      onChange={(event) => {
                        updateModel({ name: event.target.value })
                        if (fieldErrors.modelName) setFieldErrors((prev) => ({ ...prev, modelName: undefined }))
                      }}
                    />
                    {fieldErrors.modelName && <p className='field-error'>{fieldErrors.modelName}</p>}
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
