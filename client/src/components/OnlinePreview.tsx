import { Suspense, lazy, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Empty, Spin } from 'antd'
import { api } from '../api'
import type { Version } from '../types'

// three.js 体积较大，仅在真的预览 3D 模型时才加载
const ModelViewer = lazy(() => import('./ModelViewer'))

export const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
export const VIDEO_FORMATS = ['mp4', 'webm', 'mov', 'm4v', 'ogv']
export const AUDIO_FORMATS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']
export const MODEL_FORMATS = ['gltf', 'glb']

export type PreviewKind = 'image' | 'video' | 'audio' | 'model' | 'none'

export function previewKind(format?: string | null): PreviewKind {
  const f = (format || '').toLowerCase()
  if (IMAGE_FORMATS.includes(f)) return 'image'
  if (VIDEO_FORMATS.includes(f)) return 'video'
  if (AUDIO_FORMATS.includes(f)) return 'audio'
  if (MODEL_FORMATS.includes(f)) return 'model'
  return 'none'
}

interface Props {
  version: Version | null
  /** 无法预览时展示的兜底内容（通常是缩略图或占位图标） */
  fallback?: ReactNode
  assetName?: string
  /** 预览区最大高度（用于弹窗里限制大小），默认 70vh */
  maxHeight?: string
}

export default function OnlinePreview({
  version,
  fallback,
  assetName,
  maxHeight = '70vh',
}: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const kind = previewKind(version?.file_format)

  useEffect(() => {
    let alive = true
    setUrl(null)
    setError(null)
    if (!version || kind === 'none') return

    api
      .streamToken(version.id)
      .then((r) => {
        if (alive) setUrl(r.url)
      })
      .catch((e) => {
        if (alive) setError(e.response?.data?.detail || '无法生成预览链接')
      })
    return () => {
      alive = false
    }
  }, [version?.id, kind])

  if (!version || kind === 'none') return <>{fallback}</>

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Empty description={error} image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    )
  }

  if (!url) {
    return (
      <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    )
  }

  if (kind === 'model') {
    return (
      <Suspense
        fallback={
          <div style={{ height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin tip="加载 3D 查看器…" />
          </div>
        }
      >
        <ModelViewer url={url} />
      </Suspense>
    )
  }

  if (kind === 'image') {
    return (
      <div style={{ textAlign: 'center' }}>
        <img
          src={url}
          alt={assetName || 'preview'}
          style={{ maxWidth: '100%', maxHeight, objectFit: 'contain', display: 'block', margin: '0 auto' }}
        />
      </div>
    )
  }

  if (kind === 'video') {
    return (
      <video
        src={url}
        controls
        style={{ width: '100%', maxHeight, display: 'block', background: '#000' }}
      />
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <audio src={url} controls style={{ width: '100%' }} />
    </div>
  )
}
