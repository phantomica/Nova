import type { AssistantSettings } from '../../shared'
import { isSystemDiagnosticEnabled } from '../../shared'

export const agentToolFeature = {
  tools: [{
    type: 'function',
    function: {
      name: 'get_network_status',
      description: 'When enabled in Settings, read current system-wide received/sent traffic rates for network adapters. This is not an internet speed test and cannot attribute traffic to a specific download or prove a service-side bottleneck.',
      parameters: { type: 'object', properties: {} }
    }
  }],
  enabled: (settings: AssistantSettings) => isSystemDiagnosticEnabled(settings, 'network')
}
