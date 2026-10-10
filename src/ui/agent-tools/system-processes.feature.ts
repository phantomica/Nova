import type { AssistantSettings } from '../../shared'
import { isSystemDiagnosticEnabled } from '../../shared'

export const agentToolFeature = {
  tools: [
    {
      type: 'function',
      function: {
        name: 'list_resource_processes',
        description: 'When enabled in Settings, list up to 10 running processes by current CPU use and by private working-set memory. Only process names, IDs, and resource measurements are returned; command lines and user data are not collected.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'find_running_process',
        description: 'When enabled in Settings, check whether an exact process or executable name is currently running. For example, search for chrome or chrome.exe. Returns only matching process names, IDs, and memory use; command lines are not collected.',
        parameters: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Exact process name or executable name, such as chrome.exe.' } },
          required: ['name']
        }
      }
    }
  ],
  enabled: (settings: AssistantSettings) => isSystemDiagnosticEnabled(settings, 'processes')
}
