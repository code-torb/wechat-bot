import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Modal, Space, Table, Tag, message } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Agent } from '../api/types'

export default function AgentsPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [storyOpen, setStoryOpen] = useState(false)
  const [storyNameHint, setStoryNameHint] = useState('')
  const [storyFile, setStoryFile] = useState<{ base64: string; fileName: string } | null>(null)
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
  const createFromStory = useMutation({
    mutationFn: async () => {
      const result = await api<Agent>('/api/v1/agents/from-story', {
        method: 'POST',
        body: { dataBase64: storyFile?.base64, fileName: storyFile?.fileName, nameHint: storyNameHint },
      })
      return result.data
    },
    onSuccess: (result) => {
      setStoryOpen(false)
      setStoryFile(null)
      setStoryNameHint('')
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      message.success('已根据小说创建角色，请继续完善并发布')
      navigate(`/agents/${result.id}`)
    },
    onError: (error) => message.error(error instanceof Error ? error.message : '创建失败'),
  })
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
        ]}
      />
      <Modal
        title='从小说创建角色 Agent'
        open={storyOpen}
        onCancel={() => setStoryOpen(false)}
        onOk={() => createFromStory.mutate()}
        okText='创建角色'
        okButtonProps={{ disabled: !storyFile?.base64, loading: createFromStory.isPending }}
      >
        <p className='muted'>
          上传小说原文 txt。系统会提取角色姓名、出生日期、性别、职业、爱好等属性，并用原文开头作为背景故事草稿，之后可继续编辑。
        </p>
        <Input
          aria-label='角色名提示'
          placeholder='角色名（可选，解析失败时使用）'
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
            }
            reader.readAsDataURL(file)
          }}
        />
        {storyFile && (
          <p className='muted' style={{ marginTop: 8 }}>
            已选择：{storyFile.fileName}
          </p>
        )}
      </Modal>
    </div>
  )
}
