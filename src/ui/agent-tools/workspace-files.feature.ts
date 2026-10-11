import type { AssistantSettings } from '../../shared'

export const workspaceFileTools = [
  {
    type: 'function',
    function: {
      name: 'browse_files',
      description: 'Browse one allowed folder at a time. Defaults to the workspace root. Returns at most 25 entries; when more exist, continue with the returned offset. Folder paths can be workspace-relative, absolute, or an approved folder alias. Workspace and approved-folder subfolders can be browsed only when enabled for that location in Settings. Files and folders are excluded when hidden by safety rules.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional workspace-relative folder, absolute allowed folder path, or approved folder alias/path' },
          offset: { type: 'integer', minimum: 0, description: 'Offset returned by the previous page; omit or use 0 for the first page' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search filenames (not file contents) across the workspace and approved file locations at any directory depth. Scans at most 10,000 entries and returns at most 20 matching file paths; use a more specific query if the scan limit is reached. Searches nested locations only when subfolders are enabled for that location in Settings. If the user named a folder that is not accessible, set path to that folder now; the tool will request access directly instead of asking the user a separate question. After approval, repeat the search with the same query and path.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 100, description: 'A distinctive part of the filename, including extension if known' },
          path: { type: 'string', description: 'Optional folder to search when the user names a specific location, such as Downloads; may be an absolute path, known folder name, workspace-relative path, or approved alias' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: { name: 'read_file', description: 'Read a UTF-8 text file up to 128 KB from the configured workspace or an approved file location. Use an absolute path returned by browse_files or search_files, or a workspace-relative path.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path from browse_files/search_files, or workspace-relative path' } }, required: ['path'] } }
  },
  {
    type: 'function',
    function: { name: 'stage_file_change', description: 'Create, edit, or delete a text file at the exact destination requested by the user. If they specify a folder or say to use the same folder as a previously found file or executable, use that absolute folder path; never substitute the workspace or another default folder. If access is not approved, this tool will request the destination folder; after approval, the same operation is automatically retried. Never claim a staged change is applied before separate file-change approval.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Exact absolute destination path. Use the parent folder the user requested or the parent of the referenced file; only use a workspace-relative path when the user asked for the workspace.' }, operation: { type: 'string', enum: ['create', 'edit', 'delete'] }, content: { type: 'string', description: 'Complete new file content for create/edit' } }, required: ['path', 'operation'] } }
  }
]

export function workspaceFilesEnabled(settings: AssistantSettings) {
  return settings.fileOperationsEnabled
}

export const agentToolFeature = { tools: workspaceFileTools, enabled: workspaceFilesEnabled }
