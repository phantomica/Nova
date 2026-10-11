import type { AssistantSettings } from '../../shared'

export const locationAccessTools = [
  {
    type: 'function',
    function: {
      name: 'request_location_access',
      description: 'When a user-requested task needs a location outside current file access, request temporary access to the narrowest existing folder that contains the needed files. Call this tool directly instead of asking in chat whether you should request access; the approval card is the permission prompt. Explain the specific task in reason. Wait for user approval before using that location; if denied, stop work that needs it. Access lasts only for the current task and does not approve file changes or unlisted program launches; those keep their separate approval steps.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The narrowest existing folder required for the task; never request a broad parent such as Programs if a specific application folder is sufficient' },
          reason: { type: 'string', maxLength: 300, description: 'Briefly describe the user-requested task that needs this folder' }
        },
        required: ['path', 'reason']
      }
    }
  }
]

export function locationAccessEnabled(settings: AssistantSettings) {
  return settings.fileOperationsEnabled && settings.requestLocationAccessEnabled
}

export const agentToolFeature = { tools: locationAccessTools, enabled: locationAccessEnabled }
