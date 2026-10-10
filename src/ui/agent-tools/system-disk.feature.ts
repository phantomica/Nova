import type { AssistantSettings } from '../../shared'
import { isSystemDiagnosticEnabled } from '../../shared'

export const agentToolFeature = {
  tools: [{
    type: 'function',
    function: {
      name: 'get_disk_status',
      description: 'When enabled in Settings, read fixed-drive free/total capacity and physical-disk busy time and read/write rates. This does not identify which process is responsible for disk activity.',
      parameters: { type: 'object', properties: {} }
    }
  }],
  enabled: (settings: AssistantSettings) => isSystemDiagnosticEnabled(settings, 'disks')
}
