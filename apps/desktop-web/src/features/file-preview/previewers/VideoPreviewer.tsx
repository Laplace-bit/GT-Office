import { convertFileSrc } from '@tauri-apps/api/core'
import './VideoPreviewer.scss'

interface VideoPreviewerProps {
  filePath: string
}

export function VideoPreviewer({ filePath }: VideoPreviewerProps) {
  const src = convertFileSrc(filePath)

  return (
    <div className="video-previewer">
      <video
        className="video-previewer-player"
        controls
        preload="metadata"
      >
        <source src={src} />
        {/* 浏览器不支持 video 标签 */}
      </video>
    </div>
  )
}