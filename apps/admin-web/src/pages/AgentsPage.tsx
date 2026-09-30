import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Modal, Popconfirm, Radio, Space, Table, Tag, message } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Agent } from '../api/types'

type StoryCharacter = { name: string; reason: string }

export default function AgentsPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [storyOpen, setStoryOpen] = useState(false)
  const [storyNameHint, setStoryNameHint] = useState('')
  const [storyFile, setStoryFile] = useState<{ base64: string; fileName: string } | null>(null)
  const [characters, setCharacters] = useState<StoryCharacter[]>([])
  const [selectedCharacter, setSelectedCharacter] = useState<string | undefined>()
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
  const analyzeStory = useMutation({
    mutationFn: () =>
      api<{ characters: StoryCharacter[] }>('/api/v1/agents/story/analyze', {
        method: 'POST',
        body: { dataBase64: storyFile?.base64, fileName: storyFile?.fileName },
      }),
    onSuccess: (result) => {
      setCharacters(result.data.characters)
      setSelectedCharacter(undefined)
      if (result.data.characters.length) {
        message.success(`识别到 ${result.data.characters.length} 位人物，请选择要创建的角色`)
      } else {
        message.warning('没有识别到人物，请手动填写角色名')
      }
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '分析失败'),
  })
  const createFromStory = useMutation({
    mutationFn: async () => {
      const result = await api<Agent>('/api/v1/agents/from-story', {
        method: 'POST',
        body: {
          dataBase64: storyFile?.base64,
          fileName: storyFile?.fileName,
          characterName: selectedCharacter || storyNameHint,
        },
      })
      return result.data
    },
    onSuccess: (result) => {
      setStoryOpen(false)
      setStoryFile(null)
      setStoryNameHint('')
      setCharacters([])
      setSelectedCharacter(undefined)
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      message.success('已根据小说创建角色：原文已入库，人物关系已生成图谱')
      navigate(`/agents/${result.id}`)
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '创建失败'),
  })
  const removeAgent = useMutation({
    mutationFn: (agentId: string) => api(`/api/v1/agents/${agentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      message.success('Agent 已删除')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '删除失败'),
  })
  const canCreateFromStory = Boolean(storyFile?.base64 && (selectedCharacter || storyNameHint.trim()))
  return (
    <div className='page'>
      <Space style={{ marginBottom: 12 }}>
        <Input placeholder='名称' value={name} onChange={(event) => setName(event.target.value)} />
        <Button type='primary' disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
          新建 Agent
        </Button>
        <Button onClick={() => setStoryOpen(true)}>从小说创建</Button>
      </Space>
      <Table<Agent>
        rowKey='id'
        dataSource={data || []}
        onRow={(row) => ({ onClick: () => navigate(`/agents/${row.id}`), style: { cursor: 'pointer' } })}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '状态', dataIndex: 'status', render: (status: Agent['status']) => <Tag>{status}</Tag> },
          { title: '模型', render: (_, row) => row.draft?.model?.name || '未配置' },
          { title: '版本', dataIndex: 'revision' },
          { title: '已发布', dataIndex: 'publishedVersionId', render: (value) => (value ? '是' : '否') },
          {
            title: '操作',
            render: (_, row) => (
              <Popconfirm
                title='确认删除该 Agent？'
                description='已绑定 QQ 的 Agent 无法删除，需先解除绑定。'
                onConfirm={() => removeAgent.mutate(row.id)}
              >
                <Button size='small' danger onClick={(event) => event.stopPropagation()} loading={removeAgent.isPending}>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
      <Modal
        title='从小说创建角色 Agent'
        open={storyOpen}
        onCancel={() => setStoryOpen(false)}
        onOk={() => createFromStory.mutate()}
        okText='创建角色'
        okButtonProps={{ disabled: !canCreateFromStory, loading: createFromStory.isPending }}
      >
        <p className='muted'>
          上传小说原文 txt。系统先调用模型识别主要人物，你选择角色后创建：提炼该角色的经历与信息、把小说原文存入知识库、识别人物关系并生成知识图谱。
        </p>
        <Input
          aria-label='角色名提示'
          placeholder='角色名（可选，模型未识别到或想手动指定时使用）'
          value={storyNameHint}
          onChange={(event) => setStoryNameHint(event.target.value)}
          style={{ marginBottom: 10 }}
        />
        <input
          aria-label='选择小说 txt 文件'
          type='file'
          accept='.txt,text/plain'
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = String(reader.result || '')
              setStoryFile({ base64: dataUrl.split(',')[1] || '', fileName: file.name })
              setCharacters([])
              setSelectedCharacter(undefined)
            }
            reader.readAsDataURL(file)
          }}
        />
        {storyFile && (
          <Space style={{ marginTop: 10, display: 'flex' }}>
            <span className='muted'>已选择：{storyFile.fileName}</span>
            <Button size='small' loading={analyzeStory.isPending} onClick={() => analyzeStory.mutate()}>
              分析角色
            </Button>
          </Space>
        )}
        {characters.length > 0 && (
          <Radio.Group
            style={{ display: 'grid', gap: 8, marginTop: 14 }}
            value={selectedCharacter}
            onChange={(event) => setSelectedCharacter(event.target.value)}
          >
            {characters.map((character) => (
              <Radio key={character.name} value={character.name}>
                {character.name}
                {character.reason ? `（${character.reason}）` : ''}
              </Radio>
            ))}
          </Radio.Group>
        )}
      </Modal>
    </div>
  )
}
