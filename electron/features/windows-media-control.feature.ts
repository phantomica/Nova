import { controlWindowsMedia } from './windows-media-control'
import type { FeatureToolHandler } from './tool-types'

const controlMedia: FeatureToolHandler = async (args, context) => {
  if (!context.settings.mediaControlEnabled) throw new Error('Windows media controls are disabled in Settings.')
  return { result: await controlWindowsMedia(args) }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  windows_media_control: controlMedia
}
