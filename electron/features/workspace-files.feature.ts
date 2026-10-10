import type { FeatureToolHandler } from './tool-types'

const browseFiles: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const requestedPath = String(args.path ?? '')
  const offset = args.offset === undefined ? 0 : Number(args.offset)
  const listing = context.browseAccessibleFiles(requestedPath, offset)
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
  const search = context.searchAccessibleFiles(String(args.query ?? ''))
  const lines = search.matches.map((match) => `${match.name}: ${match.path}`)
  if (search.truncated) lines.push('Search stopped at its scan/result limit; narrow the filename query for more targeted results.')
  if (search.errors.length) lines.push(`Some approved locations could not be searched:\n${search.errors.join('\n')}`)
  return {
    result: `Filename matches (${search.matches.length} shown; searched ${search.scannedEntries} directory entries):\n${lines.join('\n') || '(no filename matches found)'}`
  }
}

const readFile: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('Workspace access is disabled in Settings.')
  const file = context.readAccessibleFile(String(args.path ?? ''))
  return { result: `Contents of ${file.path}:\n${file.content}` }
}

const stageChange: FeatureToolHandler = (args, context) => {
  if (!context.settings.fileOperationsEnabled) throw new Error('File operations are disabled in Settings.')
  return context.stageFileChange(args)
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  browse_files: browseFiles,
  search_files: searchFiles,
  read_file: readFile,
  stage_file_change: stageChange
}
