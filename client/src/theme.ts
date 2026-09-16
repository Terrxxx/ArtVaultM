import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'system',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'artvault-theme' },
  ),
)

const DARK_QUERY = '(prefers-color-scheme: dark)'

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 把 data-theme 写到 <html>，index.css 里的暗色变量靠它切换 */
function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

// 模块加载时先落一次，避免首帧白底闪一下（persist 是同步读 localStorage 的）
applyTheme(useThemeStore.getState().mode)

/** 'system' 解析成实际的 light/dark，并跟随系统切换 */
export function useResolvedTheme(): ResolvedTheme {
  const mode = useThemeStore((s) => s.mode)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode))

  useEffect(() => {
    setResolved(resolveTheme(mode))
    applyTheme(mode)
    if (mode !== 'system') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      setResolved(resolveTheme('system'))
      applyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return resolved
}
