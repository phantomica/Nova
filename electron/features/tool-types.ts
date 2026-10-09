import type { AssistantSettings, PendingChange } from '../../src/shared'

export type ToolOutcome = { result: string; change?: PendingChange }
export type FeatureToolContext = {
  settings: AssistantSettings
  listWorkspaceFiles: () => { files: string[]; truncated: boolean }
  safeWorkspacePath: (relativePath: string) => string
  stageFileChange: (args: Record<string, unknown>) => Promise<ToolOutcome>
}
export type FeatureToolHandler = (args: Record<string, unknown>, context: FeatureToolContext) => Promise<ToolOutcome> | ToolOutcome
