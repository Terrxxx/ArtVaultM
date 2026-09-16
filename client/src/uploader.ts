import { api } from './api'

/** 超过这个大小就走分片；以下直接一次性 POST，省一次往返 */
export const CHUNK_THRESHOLD = 8 * 1024 * 1024

export interface UploadProgress {
  /** 0~1 */
  ratio: number
  loaded: number
  total: number
}

interface Session {
  uploadId: string
  chunkSize: number
  total: number
  uploaded: Set<number>
}

/** 同一个页面内按「文件名+大小+修改时间」记住会话，失败重试时跳过已传分片 */
const sessions = new Map<string, Session>()

const fileKey = (f: File) => `${f.name}::${f.size}::${f.lastModified}`

export const needsChunkedUpload = (f: File) => f.size > CHUNK_THRESHOLD

/** 资产创建成功后调用：这一份文件不用再续传了 */
export function clearUploadSession(file: File) {
  sessions.delete(fileKey(file))
}

async function openSession(file: File, projectId: number): Promise<Session> {
  const key = fileKey(file)
  const cached = sessions.get(key)
  if (cached) {
    // 服务端可能已经把会话合并掉或清理了，先对一下账，失效就重建
    try {
      const status = await api.uploadStatus(cached.uploadId)
      return { ...cached, uploaded: new Set<number>(status.uploaded) }
    } catch {
      sessions.delete(key)
    }
  }
  const init = await api.uploadInit({
    project_id: projectId,
    file_name: file.name,
    file_size: file.size,
  })
  const session: Session = {
    uploadId: init.upload_id,
    chunkSize: init.chunk_size,
    total: init.total_chunks,
    uploaded: new Set<number>(init.uploaded),
  }
  sessions.set(key, session)
  return session
}

/**
 * 分片上传一个文件，返回后端用来合并的 upload_id。
 *
 * 中途某个分片失败时异常抛出，会话留在 sessions 里；再调一次会把已传的分片跳过。
 */
export async function uploadFileInChunks(
  file: File,
  projectId: number,
  onProgress?: (p: UploadProgress) => void,
): Promise<string> {
  const session = await openSession(file, projectId)
  const { uploadId, chunkSize, total, uploaded } = session
  const doneBytes = () => Math.min(file.size, uploaded.size * chunkSize)

  for (let i = 0; i < total; i++) {
    if (uploaded.has(i)) continue
    const start = i * chunkSize
    const blob = file.slice(start, Math.min(file.size, start + chunkSize))
    await api.uploadChunk(uploadId, i, blob, (loaded) => {
      const loadedAll = doneBytes() + loaded
      onProgress?.({ ratio: file.size ? loadedAll / file.size : 1, loaded: loadedAll, total: file.size })
    })
    uploaded.add(i)
  }

  onProgress?.({ ratio: 1, loaded: file.size, total: file.size })
  return uploadId
}
