import { useState } from 'react'
import { Button, Card, Form, Input, message } from 'antd'

type Props = {
  onLogin: (csrf: string) => void
  onSuccess: () => void
}

export default function LoginPage({ onLogin, onSuccess }: Props) {
  const [loading, setLoading] = useState(false)
  return (
    <div style={{ maxWidth: 380, margin: '80px auto' }}>
      <Card title='登录 Agent 管理台'>
        <Form
          onFinish={async (values) => {
            setLoading(true)
            try {
              const response = await fetch('/api/v1/auth/login', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(values),
              })
              const payload = await response.json()
              if (!response.ok) throw new Error(payload?.message || '登录失败')
              onLogin(payload.data.csrf)
              onSuccess()
            } catch (error) {
              message.error(error instanceof Error ? error.message : '登录失败')
            } finally {
              setLoading(false)
            }
          }}
        >
          <Form.Item name='username' rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder='用户名' autoComplete='username' />
          </Form.Item>
          <Form.Item name='password' rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder='密码' autoComplete='current-password' />
          </Form.Item>
          <Button type='primary' htmlType='submit' loading={loading} block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
