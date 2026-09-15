import { useState } from 'react'
import { Avatar, Button, Card, Form, Input, Space, Typography, Upload, message } from 'antd'
import { UserOutlined } from '@ant-design/icons'
import { api, uploadUrl } from '../api'
import { ROLE_LABEL } from '../types'
import { useAuthStore } from '../store'

const normFile = (e: any) => (Array.isArray(e) ? e : e?.fileList)

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [profileForm] = Form.useForm()
  const [pwdForm] = Form.useForm()
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)

  const onSaveProfile = async (values: any) => {
    const fd = new FormData()
    if (values.nickname !== undefined) fd.append('nickname', values.nickname ?? '')
    if (values.github_url !== undefined) fd.append('github_url', values.github_url ?? '')
    const file = values.avatar?.[0]?.originFileObj
    if (file) fd.append('avatar', file)

    setSavingProfile(true)
    try {
      const updated = await api.updateProfile(fd)
      setUser(updated)
      profileForm.setFieldValue('avatar', [])
      message.success('资料已更新')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '更新失败')
    } finally {
      setSavingProfile(false)
    }
  }

  const onChangePassword = async (values: any) => {
    setSavingPwd(true)
    try {
      await api.changePassword(values.old_password, values.new_password)
      pwdForm.resetFields()
      message.success('密码修改成功')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '修改失败')
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <Typography.Title level={4}>个人设置</Typography.Title>

      <Card title="个人资料" style={{ marginBottom: 16 }}>
        <Space align="center" size={24} style={{ marginBottom: 20 }}>
          <Avatar size={64} icon={<UserOutlined />} src={uploadUrl(user?.avatar) || undefined} />
          <div>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {user?.nickname || user?.username}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              @{user?.username}
              {user?.role && user.role !== 'member' && ` · ${ROLE_LABEL[user.role] || user.role}`}
            </Typography.Text>
          </div>
        </Space>

        <Form
          form={profileForm}
          layout="vertical"
          onFinish={onSaveProfile}
          initialValues={{ nickname: user?.nickname, github_url: user?.github_url }}
        >
          <Form.Item name="nickname" label="昵称">
            <Input placeholder="显示名称" />
          </Form.Item>
          <Form.Item name="github_url" label="GitHub 主页">
            <Input placeholder="https://github.com/your-name" />
          </Form.Item>
          <Form.Item
            name="avatar"
            label="头像"
            valuePropName="fileList"
            getValueFromEvent={normFile}
            extra="支持 jpg / png 等图片格式"
          >
            <Upload beforeUpload={() => false} maxCount={1} listType="picture-card" accept="image/*">
              选择图片
            </Upload>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={savingProfile}>
            保存资料
          </Button>
        </Form>
      </Card>

      <Card title="修改密码">
        <Form form={pwdForm} layout="vertical" onFinish={onChangePassword}>
          <Form.Item
            name="old_password"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password placeholder="当前密码" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, min: 6, message: '新密码至少 6 位' }]}
          >
            <Input.Password placeholder="新密码" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={savingPwd}>
            修改密码
          </Button>
        </Form>
      </Card>
    </div>
  )
}
