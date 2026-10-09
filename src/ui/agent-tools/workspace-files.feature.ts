import type { AssistantSettings } from '../../shared'

export const workspaceFileTools = [
  {
    type: 'function',
    function: { name: 'list_workspace_files', description: 'List up to 200 files in the configured workspace (excluding .env files, dependencies, and symbolic links).', parameters: { type: 'object', properties: {} } }
  },
  {
    type: 'function',
    function: { name: 'read_workspace_file', description: 'Read a UTF-8 text file up to 128 KB from the configured workspace.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file path' } }, required: ['path'] } }
  },
  {
    type: 'function',
    function: { name: 'stage_file_change', description: 'Create, edit, or delete a text file inside the configured workspace. Never claim a staged change is applied before approval.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Workspace-relative file path' }, operation: { type: 'string', enum: ['create', 'edit', 'delete'] }, content: { type: 'string', description: 'Complete new file content for create/edit' } }, required: ['path', 'operation'] } }
  }
]

export function workspaceFilesEnabled(settings: AssistantSettings) {
  return settings.fileOperationsEnabled
}

export const agentToolFeature = { tools: workspaceFileTools, enabled: workspaceFilesEnabled }
