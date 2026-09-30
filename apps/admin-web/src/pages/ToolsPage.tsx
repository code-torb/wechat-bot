import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Form, Input, InputNumber, Table, Tag, Upload } from 'antd'
import { api } from '../api/client'
import type { Approval, MemeAsset } from '../api/types'

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ToolsPage() {
  const queryClient = useQueryClient()
  const { data: memes } = useQuery({
    queryKey: ['memes'],
    queryFn: () => api<MemeAsset[]>('/api/v1/meme-assets').then((result) => result.data),
  })
  const { data: approvals } = useQuery({
    queryKey: ['approvals'],
    queryFn: () => api<Approval[]>('/api/v1/approvals').then((result) => result.data),
  })
  const upload = useMutation({
    mutationFn: async ({ file, tags }: { file: File; tags: string }) =>
      api('/api/v1/meme-assets', {
        method: 'POST',
        body: { dataBase64: await readBase64(file), tags: tags ? tags.split(',') : [] },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memes'] })
    },
  })
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'confirm' | 'reject' }) =>
      api(`/api/v1/approvals/${id}/${decision}`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals'] }),
  })
  return (
    <div className='page'>
      <h2>工具与资源</h2>
      <Form layout='inline' style={{ marginBottom: 12 }}>
        <Form.Item label='表情包'>
          <Upload
            accept='image/png,image/jpeg,image/gif,image/webp'
            showUploadList={false}
            beforeUpload={(file, fileList) => {
              upload.mutate({ file, tags: '' })
              return false
            }}
          >
            <Button>选择图片（≤2MB）</Button>
          </Upload>
        </Form.Item>
      </Form>
      <Table<MemeAsset>
        rowKey='id'
        size='small'
        dataSource={memes || []}
        columns={[
          { title: '类型', dataIndex: 'mime' },
          { title: '大小', dataIndex: 'bytes', render: (value: number) => `${Math.round(value / 1024)}KB` },
          { title: '标签', dataIndex: 'tags', render: (value: string[]) => value.join(', ') },
          { title: '状态', dataIndex: 'enabled', render: (value: boolean) => (value ? <Tag color='green'>启用</Tag> : <Tag>停用</Tag>) },
        ]}
      />
      <h3 style={{ marginTop: 24 }}>文件写入审批</h3>
      <Table<Approval>
        rowKey='id'
        size='small'
        dataSource={approvals || []}
        columns={[
          { title: '目标', dataIndex: 'proposalRef' },
          { title: '状态', dataIndex: 'status', render: (value: string) => <Tag>{value}</Tag> },
          { title: '到期', dataIndex: 'expiresAt', render: (value: number) => new Date(value).toLocaleString() },
          {
            title: '操作',
            render: (_, row) =>
              row.status === 'pending' ? (
                <>
                  <Button size='small' type='primary' onClick={() => decide.mutate({ id: row.id, decision: 'confirm' })}>
                    批准
                  </Button>
                  <Button size='small' danger style={{ marginLeft: 8 }} onClick={() => decide.mutate({ id: row.id, decision: 'reject' })}>
                    拒绝
                  </Button>
                </>
              ) : null,
          },
        ]}
      />
      <h3 style={{ marginTop: 24 }}>新增文件资源</h3>
      <Form
        layout='inline'
        onFinish={(values) =>
          api('/api/v1/file-resources', {
            method: 'POST',
            body: {
              mountAlias: values.mountAlias,
              operations: (values.operations || 'list,read,create,update').split(','),
              maxBytes: values.maxBytes || 1048576,
              dailyWriteLimit: values.dailyWriteLimit || 0,
              autoApprove: values.autoApprove === 'true',
            },
          })
            .then(() => queryClient.invalidateQueries())
            .catch(() => {})
        }
      >
        <Form.Item name='mountAlias' rules={[{ required: true }]}>
          <Input placeholder='挂载别名，如 notes' />
        </Form.Item>
        <Form.Item name='operations'>
          <Input placeholder='操作，逗号分隔' />
        </Form.Item>
        <Form.Item name='maxBytes'>
          <InputNumber min={1} placeholder='最大字节' />
        </Form.Item>
        <Form.Item name='autoApprove' initialValue='false'>
          <Input placeholder='autoApprove: true/false' style={{ width: 180 }} />
        </Form.Item>
        <Button htmlType='submit'>登记资源</Button>
      </Form>
    </div>
  )
}
