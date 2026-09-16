import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import { useResolvedTheme } from './theme'
import './index.css'

// 暗色用 GitHub 深色模式的配色：底 #0d1117、面板 #161b22、描边 #30363d、正文 #e6edf3
const DARK_TOKENS = {
  colorPrimary: '#1f6feb',
  colorLink: '#58a6ff',
  colorInfo: '#58a6ff',
  colorSuccess: '#3fb950',
  colorWarning: '#d29922',
  colorError: '#f85149',
  colorBgBase: '#0d1117',
  colorBgLayout: '#0d1117',
  colorBgContainer: '#161b22',
  colorBgElevated: '#161b22',
  colorBgSpotlight: '#30363d',
  colorText: '#e6edf3',
  colorTextSecondary: '#8b949e',
  colorTextTertiary: '#6e7681',
  colorBorder: '#30363d',
  colorBorderSecondary: '#21262d',
}

function ThemedApp() {
  const resolved = useResolvedTheme()
  const isDark = resolved === 'dark'

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: '#6c5ce7', ...(isDark ? DARK_TOKENS : {}) },
      }}
    >
      <App />
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>,
)
