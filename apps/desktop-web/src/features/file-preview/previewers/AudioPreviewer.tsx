import { Music } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import './AudioPreviewer.scss'

interface AudioPreviewerProps {
  filePath: string
}

export function AudioPreviewer({ filePath }: AudioPreviewerProps) {
  const src = convertFileSrc(filePath)
  const fileName = filePath.split('/').pop() || filePath

  return (
    <div className="audio-previewer">
      <div className="audio-previewer-cover">
        <Music className="audio-previewer-icon" aria-hidden="true" />
      </div>
      <div className="audio-previewer-info">
        <span className="audio-previewer-name">{fileName}</span>
      </div>
      <audio
        className="audio-previewer-player"
        controls
        preload="metadata"
      >
        <source src={src} />
      </audio>
    </div>
  )
}