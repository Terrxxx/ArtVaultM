import { useState } from 'react'
import { Button, Card, Form, Input, message, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuthStore } from '../store'

export default function Login() {
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const { access_token } = await api.login(values.username, values.password)
      useAuthStore.setState({ token: access_token })
      const user = await api.me()
      setAuth(access_token, user)
      message.success('登录成功')
      navigate('/')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%)',
      }}
    >
      <Card style={{ width: 'min(380px, 100%)', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            艺库 ArtVault
          </Typography.Title>
          <Typography.Text type="secondary">游戏美术资产管理系统</Typography.Text>
        </div>
        <Form onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}
