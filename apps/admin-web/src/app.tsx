import { useEffect, useState } from 'react'
import { Layout, Menu, Spin, message } from 'antd'
import {
  AppstoreOutlined,
  RobotOutlined,
  MessageOutlined,
  SettingOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  KeyOutlined,
  AuditOutlined,
} from '@ant-design/icons'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, setCsrf, setToast } from './api/client'
import LoginPage from './pages/LoginPage'
import AgentsPage from './pages/AgentsPage'
import AgentDetailPage from './pages/AgentDetailPage'
import StylesPage from './pages/StylesPage'
import QQPage from './pages/QQPage'
import ConversationsPage from './pages/ConversationsPage'
import CommandsPage from './pages/CommandsPage'
import ToolsPage from './pages/ToolsPage'
import ModelsPage from './pages/ModelsPage'
import AuditPage from './pages/AuditPage'

function useAuth() {
  const [user, setUser] = useState<null | { username: string; role: string } | 'loading'>('loading')
  useEffect(() => {
    api<{ username: string; role: string; csrf: string }>('/api/v1/auth/me')
      .then((result) => {
        setCsrf(result.data.csrf)
        setUser(result.data)
      })
      .catch(() => {
        setCsrf('')
        setUser(null)
      })
  }, [])
  return { user, setUser }
}

function Shell() {
  const { user, setUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [messageApi, contextHolder] = message.useMessage()
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    setToast((type, content) => {
      if (type === 'success') messageApi.success(content)
      else messageApi.error(content)
    })
  }, [messageApi])
  if (user === 'loading') return <Spin style={{ display: 'block', margin: '80px auto' }} />
  if (!user) return <LoginPage onLogin={(csrf) => setCsrf(csrf)} onSuccess={() => window.location.reload()} />
  const items = [
    { key: '/agents', icon: <RobotOutlined />, label: <Link to='/agents'>Agents</Link> },
    { key: '/styles', icon: <SettingOutlined />, label: <Link to='/styles'>对话设定</Link> },
    { key: '/qq', icon: <AppstoreOutlined />, label: <Link to='/qq'>QQ 权限</Link> },
    { key: '/conversations', icon: <HistoryOutlined />, label: <Link to='/conversations'>会话记录</Link> },
    { key: '/commands', icon: <MessageOutlined />, label: <Link to='/commands'>命令模板</Link> },
    { key: '/tools', icon: <FileSearchOutlined />, label: <Link to='/tools'>工具与资源</Link> },
    { key: '/models', icon: <KeyOutlined />, label: <Link to='/models'>模型</Link> },
    { key: '/audit', icon: <AuditOutlined />, label: <Link to='/audit'>审计</Link> },
  ]
  const selected = items.find((item) => location.pathname.startsWith(item.key))
  return (
    <Layout style={{ minHeight: '100vh' }}>
      {contextHolder}
      <Layout.Sider theme='light' width={220} collapsible collapsed={collapsed} onCollapse={setCollapsed}>
        {!collapsed && <div className='app-brand'>Agent 管理台</div>}
        <Menu mode='inline' inlineCollapsed={collapsed} selectedKeys={selected ? [selected.key] : []} items={items} />
      </Layout.Sider>
      <Layout.Content>
        <div style={{ padding: '0 16px' }}>
          <Routes>
            <Route path='/agents' element={<AgentsPage />} />
            <Route path='/agents/:id' element={<AgentDetailPage />} />
            <Route path='/styles' element={<StylesPage />} />
            <Route path='/qq' element={<QQPage owner={user.username} />} />
            <Route path='/conversations' element={<ConversationsPage />} />
            <Route path='/commands' element={<CommandsPage />} />
            <Route path='/tools' element={<ToolsPage />} />
            <Route path='/models' element={<ModelsPage />} />
            <Route path='/audit' element={<AuditPage />} />
            <Route path='*' element={<Navigate to='/agents' replace />} />
          </Routes>
        </div>
      </Layout.Content>
    </Layout>
  )
}

export default function App() {
  return <Shell />
}
