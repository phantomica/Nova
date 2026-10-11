import type { FeatureToolHandler } from './tool-types'

const requestLocationAccess: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled || !context.settings.requestLocationAccessEnabled) {
    throw new Error('Agent file access and temporary location requests must both be enabled in Settings.')
  }
  const requestedPath = context.resolveKnownFolderPath(String(args.path ?? ''))
  const reason = String(args.reason ?? '').trim()
  if (!reason || reason.length > 300) throw new Error('Explain briefly why this location is needed (maximum 300 characters).')
  const locationAccess = context.requestLocationAccess(requestedPath, reason, context.taskId)
  return {
    result: `Access to ${locationAccess.path} is waiting for user approval. Approval grants access only for this task and does not approve file changes or program launches.`,
    locationAccess
  }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  request_location_access: requestLocationAccess
}
