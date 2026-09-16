import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Spin, Typography } from 'antd'

/** 加载时轮着换的美术梗文案，比干巴巴的转圈多点意思 */
const CAPTIONS = [
  '正在展 UV…',
  '正在烘焙法线…',
  '正在等渲染…',
  '正在补材质…',
  '正在对齐骨骼…',
  '正在拆分拓扑…',
  '正在导出 FBX…',
  '正在调光照…',
]

const ROTATE_MS = 1400

interface Props {
  /** 传了就固定显示这句，不轮换 */
  text?: string
  /** 外层留白，默认整页 */
  padding?: number
  style?: CSSProperties
}

/** 带美术梗文案的加载指示 */
export default function ArtSpin({ text, padding = 80, style }: Props) {
  const [i, setI] = useState(0)

  useEffect(() => {
    if (text) return
    const timer = window.setInterval(() => setI((n) => n + 1), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [text])

  return (
    <div style={{ textAlign: 'center', padding, ...style }}>
      <Spin size="large" />
      <div style={{ marginTop: 12 }}>
        <Typography.Text type="secondary">
          {text || CAPTIONS[i % CAPTIONS.length]}
        </Typography.Text>
      </div>
    </div>
  )
}
