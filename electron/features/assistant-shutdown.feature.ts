import type { FeatureToolHandler } from './tool-types'

const shutdownAssistant: FeatureToolHandler = (_args, context) => {
  if (!context.settings.allowAssistantShutdown) throw new Error('Nova shutdown from chat is disabled in Settings.')
  context.shutdownAssistant()
  return { result: 'Nova is shutting down.' }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  shutdown_assistant: shutdownAssistant
}
