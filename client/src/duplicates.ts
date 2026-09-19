import { message } from 'antd'
import type { DuplicateHit } from './types'

/**
 * 上传完成后提示「库里已有一份完全相同的文件」。
 *
 * 批量上传时把各个文件的命中合并成一条，最多列几条，免得刷屏。
 */
export function warnDuplicates(all: DuplicateHit[], max = 3) {
  if (all.length === 0) return
  const shown = all.slice(0, max)
  const lines = shown.map((d) => `　${d.project_name} / ${d.asset_name} v${d.version}`)
  const rest = all.length - shown.length
  message.warning({
    content: `库里已有一份完全相同的文件：\n${lines.join('\n')}${rest > 0 ? `\n　…另有 ${rest} 处` : ''}`,
    duration: 6,
    style: { whiteSpace: 'pre-line' },
  })
}
