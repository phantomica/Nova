import type { AssistantSettings } from '../../shared'
import { isSystemDiagnosticEnabled } from '../../shared'

export const agentToolFeature = {
  tools: [{
    type: 'function',
    function: {
      name: 'get_system_performance',
      description: 'When enabled in Settings, take a read-only snapshot of overall CPU utilization, memory use, and logical processor count to help investigate lag or high resource use. Point-in-time values may not establish a cause.',
      parameters: { type: 'object', properties: {} }
    }
  }],
  enabled: (settings: AssistantSettings) => isSystemDiagnosticEnabled(settings, 'performance')
}
