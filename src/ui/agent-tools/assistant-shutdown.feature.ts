import type { AssistantSettings } from '../../shared'

const tools = [{
  type: 'function',
  function: {
    name: 'shutdown_assistant',
    description: 'Exit Nova only when the user explicitly asks Nova to shut down or quit. This closes Nova itself, not the computer or other applications.',
    parameters: { type: 'object', properties: {} }
  }
}]

export function assistantShutdownEnabled(settings: AssistantSettings) {
  return settings.allowAssistantShutdown
}

export const agentToolFeature = { tools, enabled: assistantShutdownEnabled }
