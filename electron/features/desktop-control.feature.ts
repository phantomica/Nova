import path from 'node:path'
import { closeApplication, hasUriScheme, isApplicationAllowed, openApplication, openExplorerLocation, openWindowsSettings } from './application-control'
import type { FeatureToolHandler } from './tool-types'

const openApp: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled) throw new Error('Desktop app control is disabled in Settings.')
  const requested = String(args.name ?? '').trim()
  if (!requested) throw new Error('Application name or path is required.')
  if (!isApplicationAllowed(requested, context.settings.allowedApps)
    && context.settings.fileOperationsEnabled
    && context.settings.requestLocationAccessEnabled
    && context.settings.askBeforeUnlistedAppLaunch
    && path.isAbsolute(requested)
    && !context.isAccessibleFilePath(requested)) {
    const locationAccess = context.requestLocationAccess(
      path.dirname(requested),
      `The requested task needs Nova to locate and run this unlisted program.`,
      context.taskId
    )
    return {
      result: `Access to ${locationAccess.path} is waiting for user approval. This does not approve launching the unlisted program.`,
      locationAccess
    }
  }
  if (isApplicationAllowed(requested, context.settings.allowedApps)) {
    return { result: await openApplication(requested, context.settings.allowedApps) }
  }
  if (!context.settings.askBeforeUnlistedAppLaunch) {
    throw new Error(`${requested} is not in your allowed apps list. Enable approval for unlisted apps in Settings to request one-time permission.`)
  }
  if (hasUriScheme(requested)) {
    throw new Error('One-time approval is limited to executable names and paths, not application links.')
  }
  const applicationLaunch = context.requestApplicationLaunch(requested)
  return {
    result: `Opening ${requested} is waiting for user approval. Do not claim that it has been launched.`,
    applicationLaunch
  }
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
  return { result: await openExplorerLocation(String(args.path ?? ''), context.settings.allowedFolders, context.settings.allowedFolderSubfolders) }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  open_application: openApp,
  close_application: closeApp,
  open_windows_settings: openSettings,
  open_explorer_location: openExplorer
}
