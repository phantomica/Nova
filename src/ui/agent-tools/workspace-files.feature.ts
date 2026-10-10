import type { AssistantSettings } from '../../shared'

export const workspaceFileTools = [
  {
    type: 'function',
    function: {
      name: 'browse_files',
      description: 'Browse one allowed folder at a time. Defaults to the workspace root. Returns at most 25 entries; when more exist, continue with the returned offset. Folder paths can be workspace-relative, absolute, or an approved folder alias. Files and folders are excluded when hidden by safety rules; approved-folder subfolders can be browsed only when enabled in Settings.',
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
      description: 'Search filenames (not file contents) across the workspace and approved file locations. Returns at most 20 matching file paths; use a more specific query if the scan limit is reached. Searches nested approved folders only when enabled in Settings.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2, maxLength: 100, description: 'A distinctive part of the filename, including extension if known' } },
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
    function: { name: 'stage_file_change', description: 'Create, edit, or delete a text file inside the configured workspace or an approved file location. Use an absolute path from the file listing, or a workspace-relative path. Never claim a staged change is applied before approval.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path from the file listing, or workspace-relative path' }, operation: { type: 'string', enum: ['create', 'edit', 'delete'] }, content: { type: 'string', description: 'Complete new file content for create/edit' } }, required: ['path', 'operation'] } }
  }
]

export function workspaceFilesEnabled(settings: AssistantSettings) {
  return settings.fileOperationsEnabled
}

export const agentToolFeature = { tools: workspaceFileTools, enabled: workspaceFilesEnabled }
