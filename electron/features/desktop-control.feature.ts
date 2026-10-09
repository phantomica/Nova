import { closeApplication, openApplication, openExplorerLocation, openWindowsSettings } from './application-control'
import { controlWindowsMedia } from './windows-media-control'
import type { FeatureToolHandler } from './tool-types'

const openApp: FeatureToolHandler = (_args, context) => {
  if (!context.settings.appControlEnabled) throw new Error('Desktop app control is disabled in Settings.')
  return openApplication(String(_args.name ?? ''), context.settings.allowedApps).then((result) => ({ result }))
}

const closeApp: FeatureToolHandler = (args, context) => {
  if (!context.settings.appControlEnabled) throw new Error('Desktop app control is disabled in Settings.')
  return { result: closeApplication(String(args.name ?? '')) }
}

const openSettings: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled) throw new Error('Desktop app control is disabled in Settings.')
  return { result: await openWindowsSettings(String(args.page ?? '')) }
}

const openExplorer: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled) throw new Error('Desktop app control is disabled in Settings.')
  return { result: await openExplorerLocation(String(args.path ?? ''), context.settings.allowedFolders) }
}

const mediaControl: FeatureToolHandler = async (args, context) => {
  if (!context.settings.mediaControlEnabled) throw new Error('Windows media controls are disabled in Settings.')
  return { result: await controlWindowsMedia(String(args.action ?? '')) }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  open_application: openApp,
  close_application: closeApp,
  open_windows_settings: openSettings,
  open_explorer_location: openExplorer,
  windows_media_control: mediaControl
}
