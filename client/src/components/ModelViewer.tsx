import { useEffect, useRef, useState } from 'react'
import { Spin, Typography } from 'antd'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/** 3D 模型查看器：自动居中并支持鼠标旋转/平移/缩放。单独成文件以便按需加载 three.js。 */
export default function ModelViewer({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = container.current
    if (!el || !url) return

    let disposed = false
    let raf = 0

    const width = el.clientWidth || 480
    const height = 360

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf2f3f5)

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 5000)
    camera.position.set(3, 3, 3)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    scene.add(new THREE.AmbientLight(0xffffff, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(5, 10, 7)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(-6, -4, -8)
    scene.add(fill)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08

    const grid = new THREE.GridHelper(10, 10, 0xcccccc, 0xe5e5e5)
    grid.position.y = -0.001
    scene.add(grid)

    const loader = new GLTFLoader()
    loader.load(
      url,
      (gltf) => {
        if (disposed) return
        scene.add(gltf.scene)

        // 依据模型包围盒把相机摆到能看全的位置
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z, 0.001)
        const distance = radius * 2.2

        camera.position.set(center.x + distance, center.y + distance * 0.6, center.z + distance)
        camera.near = radius / 100
        camera.far = radius * 100
        camera.updateProjectionMatrix()
        controls.target.copy(center)
        controls.update()

        setLoading(false)
      },
      undefined,
      (err) => {
        if (disposed) return
        setLoading(false)
        setError(`模型加载失败：${(err as Error)?.message || '未知错误'}`)
      },
    )

    const animate = () => {
      raf = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const w = el.clientWidth || width
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement)
    }
  }, [url])

  return (
    <div>
      <div
        ref={container}
        style={{
          width: '100%',
          height: 360,
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f2f3f5',
        }}
      >
        {loading && !error && <Spin />}
        {error && <Typography.Text type="secondary">{error}</Typography.Text>}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        鼠标左键旋转，右键平移，滚轮缩放
      </Typography.Text>
    </div>
  )
}
