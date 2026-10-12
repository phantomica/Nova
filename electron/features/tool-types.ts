import type { AssistantSettings, PendingApplicationClose, PendingApplicationLaunch, PendingLocationAccess, ToolOutcome } from '../../src/shared'

export type FeatureToolContext = {
  settings: AssistantSettings
  taskId: string
  browseAccessibleFiles: (requestedPath: string, offset: number) => {
    directory: string
    entries: Array<{ name: string; type: 'folder' | 'file'; path: string; accessible: boolean }>
    total: number
    nextOffset?: number
    hasMore: boolean
  }
  searchAccessibleFiles: (query: string, requestedPath?: string) => {
    matches: Array<{ name: string; path: string }>
    scannedEntries: number
    truncated: boolean
    errors: string[]
  }
  readAccessibleFile: (requestedPath: string) => { path: string; content: string }
  isAccessibleFilePath: (requestedPath: string) => boolean
  stageFileChange: (args: Record<string, unknown>) => Promise<ToolOutcome>
  requestApplicationLaunch: (application: string) => PendingApplicationLaunch
  requestApplicationClose: (application: string) => PendingApplicationClose
  requestLocationAccess: (requestedPath: string, reason: string, taskId: string) => PendingLocationAccess
  resolveKnownFolderPath: (requestedPath: string) => string
  shutdownAssistant: () => void
}
export type FeatureToolHandler = (args: Record<string, unknown>, context: FeatureToolContext) => Promise<ToolOutcome> | ToolOutcome
