import path from 'node:path'
import { closeApplication, isApplicationAllowed, openApplication, openWindowsSettings, openExplorerLocation, resolveApplicationTarget } from './application-control'
import type { FeatureToolHandler } from './tool-types'

const openApp: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled || !context.settings.appLaunchEnabled) throw new Error('Application launching is disabled in Settings.')
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
  const resolved = await resolveApplicationTarget(requested, context.settings.allowedApps)
  const applicationLaunch = context.requestApplicationLaunch(resolved.target)
  return {
    result: `Opening ${resolved.displayName} (${resolved.target}) is waiting for user approval. Do not claim that it has been launched.`,
    applicationLaunch
  }
}

const closeApp: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled || !context.settings.appCloseEnabled) throw new Error('Application closing is disabled in Settings.')
  const requested = String(args.name ?? '').trim()
  if (!requested) throw new Error('Application name or path is required.')
  if (isApplicationAllowed(requested, context.settings.allowedApps)) {
    return { result: await closeApplication(requested, context.settings.allowedApps) }
  }
  if (!context.settings.askBeforeUnlistedAppClose) {
    throw new Error(`${requested} is not in your allowed apps list. Enable approval for closing unlisted programs in Settings to request one-time permission.`)
  }
  const resolved = await resolveApplicationTarget(requested, context.settings.allowedApps)
  if (resolved.type !== 'executable') throw new Error('Nova can close executable applications, not application links.')
  const applicationClose = context.requestApplicationClose(resolved.target)
  return {
    result: `Closing ${resolved.displayName} (${resolved.target}) is waiting for one-time approval. Nova will only request a graceful close.`,
    applicationClose
  }
}

const openSettings: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled || !context.settings.windowsSettingsEnabled) throw new Error('Opening Windows Settings is disabled in Settings.')
  return { result: await openWindowsSettings(String(args.page ?? '')) }
}

const openExplorer: FeatureToolHandler = async (args, context) => {
  if (!context.settings.appControlEnabled || !context.settings.fileExplorerEnabled) throw new Error('Opening File Explorer is disabled in Settings.')
  return { result: await openExplorerLocation(String(args.path ?? '')) }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  open_application: openApp,
  close_application: closeApp,
  open_windows_settings: openSettings,
  open_explorer_location: openExplorer
}
