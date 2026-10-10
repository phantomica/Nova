import type { AssistantSettings, PendingApplicationLaunch, ToolOutcome } from '../../src/shared'

export type FeatureToolContext = {
  settings: AssistantSettings
  browseAccessibleFiles: (requestedPath: string, offset: number) => {
    directory: string
    entries: Array<{ name: string; type: 'folder' | 'file'; path: string; accessible: boolean }>
    total: number
    nextOffset?: number
    hasMore: boolean
  }
  searchAccessibleFiles: (query: string) => {
    matches: Array<{ name: string; path: string }>
    scannedEntries: number
    truncated: boolean
    errors: string[]
  }
  readAccessibleFile: (requestedPath: string) => { path: string; content: string }
  stageFileChange: (args: Record<string, unknown>) => Promise<ToolOutcome>
  requestApplicationLaunch: (application: string) => PendingApplicationLaunch
}
export type FeatureToolHandler = (args: Record<string, unknown>, context: FeatureToolContext) => Promise<ToolOutcome> | ToolOutcome
