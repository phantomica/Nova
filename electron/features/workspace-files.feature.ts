import path from 'node:path'
import type { FeatureToolContext, FeatureToolHandler } from './tool-types'

function requestTemporaryAccess(error: unknown, folderPath: string, action: string, context: FeatureToolContext) {
  const isBoundaryError = error instanceof Error && (
    error.message.startsWith('Folder must be the workspace or an approved file location')
    || error.message.startsWith('File path must be inside your workspace')
  )
  if (!isBoundaryError || !context.settings.requestLocationAccessEnabled) throw error
  const locationAccess = context.requestLocationAccess(folderPath, `The requested task needs Nova to ${action}.`, context.taskId)
  return {
    result: `Access to ${locationAccess.path} is waiting for user approval. Do not continue with file operations until approved.`,
    locationAccess
  }
}

const browseFiles: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const requestedPath = context.resolveKnownFolderPath(String(args.path ?? ''))
  const offset = args.offset === undefined ? 0 : Number(args.offset)
  let listing
  try {
    listing = context.browseAccessibleFiles(requestedPath, offset)
  } catch (error) {
    return requestTemporaryAccess(error, requestedPath, 'browse this folder', context)
  }
  const entries = listing.entries.map((entry) =>
    `${entry.type === 'folder' ? '[Folder]' : '[File]'} ${entry.path}${entry.type === 'folder' && !entry.accessible ? ' (subfolder access is disabled)' : ''}`)
  const nextPage = listing.hasMore
    ? `More entries are available; call browse_files again with path=${JSON.stringify(listing.directory)} and offset=${listing.nextOffset}.`
    : 'End of this folder.'
  return {
    result: `Folder: ${listing.directory}\nShowing ${listing.entries.length} of ${listing.total} entries (maximum 25 per call).\n${entries.join('\n') || '(folder is empty)'}\n${nextPage}`
  }
}

const searchFiles: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const requestedPath = args.path === undefined ? undefined : context.resolveKnownFolderPath(String(args.path))
  let search
  try {
    search = context.searchAccessibleFiles(String(args.query ?? ''), requestedPath)
  } catch (error) {
    if (requestedPath === undefined) throw error
    return requestTemporaryAccess(error, requestedPath, 'search filenames in this folder', context)
  }
  const lines = search.matches.map((match) => `${match.name}: ${match.path}`)
  if (search.truncated) lines.push('Search stopped at its scan/result limit; narrow the filename query for more targeted results.')
  if (search.errors.length) lines.push(`Some approved locations could not be searched:\n${search.errors.join('\n')}`)
  return {
    result: `Filename matches (${search.matches.length} shown; searched ${search.scannedEntries} directory entries):\n${lines.join('\n') || '(no filename matches found)'}`
  }
}

const readFile: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const requestedPath = context.resolveKnownFolderPath(String(args.path ?? ''))
  let file
  try {
    file = context.readAccessibleFile(requestedPath)
  } catch (error) {
    return requestTemporaryAccess(error, path.dirname(requestedPath), 'read this file', context)
  }
  return { result: `Contents of ${file.path}:\n${file.content}` }
}

const stageChange: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('File operations are disabled in Settings.')
  const requestedPath = context.resolveKnownFolderPath(String(args.path ?? ''))
  const normalizedArgs = { ...args, path: requestedPath }
  return context.stageFileChange(normalizedArgs).catch((error: unknown) =>
    requestTemporaryAccess(error, path.dirname(requestedPath), 'prepare the requested file change', context))
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  browse_files: browseFiles,
  search_files: searchFiles,
  read_file: readFile,
  stage_file_change: stageChange
}
