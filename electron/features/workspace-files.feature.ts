import { existsSync, readFileSync } from 'node:fs'
import type { FeatureToolHandler } from './tool-types'

const listFiles: FeatureToolHandler = (_args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const listing = context.listWorkspaceFiles()
  return { result: `${listing.files.join('\n') || '(workspace is empty)'}${listing.truncated ? '\n… limited to the first 200 files' : ''}` }
}

const readFile: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const relativePath = String(args.path ?? '')
  const target = context.safeWorkspacePath(relativePath)
  if (!existsSync(target)) throw new Error('That file does not exist.')
  const data = readFileSync(target)
  if (data.length > 128 * 1024) throw new Error('File is larger than the 128 KB read limit.')
  if (data.includes(0)) throw new Error('Binary files cannot be read as text.')
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(data)
    return { result: `Contents of ${relativePath}:\n${content}` }
  } catch {
    throw new Error('File is not valid UTF-8 text.')
  }
}

const stageChange: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('File operations are disabled in Settings.')
  return context.stageFileChange(args)
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  list_workspace_files: listFiles,
  read_workspace_file: readFile,
  stage_file_change: stageChange
}
