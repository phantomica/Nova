export type AssistantSettings = {
  assistantName: string
  appName: string
  themePreset: 'nova' | 'midnight' | 'dusk'
  accentColor: string
  ollamaUrl: string
  model: string
  workspace: string
  workspaceSubfolders: boolean
  wakeWord: string
  wakeWordEnabled: boolean
  rememberFloatingPosition: boolean
  restoreChatWindowPosition: boolean
  chatSizeBehavior: 'on-open' | 'on-restart' | 'never'
  interruptSpeechOnVoiceInput: boolean
  speakReplies: boolean
  speechVoice: string
  speechLanguage: string
  speechRate: number
  bubbleDurationSeconds: number
  bubbleDurationMode: 'fixed' | 'after-speech'
  confirmFileChanges: boolean
  webSearchEnabled: boolean
  systemDiagnosticsEnabled: boolean
  diagnosticsPerformanceEnabled: boolean
  diagnosticsProcessesEnabled: boolean
  diagnosticsNetworkEnabled: boolean
  diagnosticsDisksEnabled: boolean
  fileOperationsEnabled: boolean
  requestLocationAccessEnabled: boolean
  appControlEnabled: boolean
  appLaunchEnabled: boolean
  appCloseEnabled: boolean
  fileExplorerEnabled: boolean
  windowsSettingsEnabled: boolean
  allowAssistantShutdown: boolean
  askBeforeUnlistedAppLaunch: boolean
  askBeforeUnlistedAppClose: boolean
  mediaControlEnabled: boolean
  apiAccessEnabled: boolean
  allowedApps: AllowedApplication[]
  allowedFolders: string[]
  allowedFolderSubfolders: string[]
  apiIntegrations: ApiIntegration[]
  programDefaultsVersion?: number
}

export type AllowedApplication = {
  name: string
  target: string
  type: 'executable' | 'link'
}

export type SystemDiagnosticCategory = 'performance' | 'processes' | 'network' | 'disks'

export function isSystemDiagnosticEnabled(settings: AssistantSettings, category: SystemDiagnosticCategory) {
  if (!settings.systemDiagnosticsEnabled) return false
  switch (category) {
    case 'performance': return settings.diagnosticsPerformanceEnabled
    case 'processes': return settings.diagnosticsProcessesEnabled
    case 'network': return settings.diagnosticsNetworkEnabled
    case 'disks': return settings.diagnosticsDisksEnabled
  }
}

export type ApiOperation = {
  id: string
  name: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  requireConfirmation: boolean
}

export type ApiIntegration = {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  requiresBearerToken: boolean
  operations: ApiOperation[]
}

export type PendingApiAction = {
  id: string
  integrationId: string
  operationId: string
  integration: string
  baseUrl: string
  operation: string
  method: ApiOperation['method']
  path: string
  arguments: Record<string, unknown>
}

export type PendingApplicationLaunch = {
  id: string
  application: string
}

export type PendingApplicationClose = {
  id: string
  application: string
}

export type PendingLocationAccess = {
  id: string
  path: string
  reason: string
}

export type LocationAccessResolution = {
  id: string
  taskId: string
  approved: boolean
  result: string
}

export type ApplicationLaunchResolution = {
  id: string
  action: 'approved' | 'denied'
  result: string
}

export type ApplicationCloseResolution = ApplicationLaunchResolution

export type ToolOutcome = {
  result: string
  change?: PendingChange
  apiAction?: PendingApiAction
  applicationLaunch?: PendingApplicationLaunch
  applicationClose?: PendingApplicationClose
  locationAccess?: PendingLocationAccess
}

export type ActionTrace = {
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'succeeded' | 'failed' | 'pending' | 'denied'
  result: string
}

export type PendingChange = {
  id: string
  path: string
  temporaryAccessRoot?: string
  operation: 'create' | 'edit' | 'delete'
  before: string | null
  after: string | null
  createdAt: number
}

export type AgentToolCall = {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: AgentToolCall[]
}

export type BubbleContent = {
  text: string
  side: 'left' | 'right'
  status?: boolean
  changes?: PendingChange[]
  applicationLaunches?: PendingApplicationLaunch[]
  applicationCloses?: PendingApplicationClose[]
  locationAccessRequests?: PendingLocationAccess[]
}

export type ChangeResolution = {
  id: string
  action: 'approved' | 'denied'
}

export type SpeechProgress = {
  status: string
  file?: string
  progress?: number
  message?: string
}

export type AssistantActivity = 'idle' | 'listening' | 'wake-heard' | 'recognizing' | 'thinking' | 'speaking'

export type DesktopApi = {
  getSettings: () => Promise<AssistantSettings>
  saveSettings: (settings: AssistantSettings) => Promise<AssistantSettings>
  pickFolder: () => Promise<string | undefined>
  pickExecutable: () => Promise<string | undefined>
  onSettingsUpdated: (listener: (settings: AssistantSettings) => void) => () => void
  listModels: (url: string) => Promise<string[]>
  chat: (requestId: string, url: string, model: string, messages: OllamaMessage[], tools: object[]) => Promise<OllamaMessage>
  runTool: (name: string, args: Record<string, unknown>, taskId: string) => Promise<ToolOutcome>
  resolveApiAction: (id: string, approve: boolean) => Promise<string>
  resolveApplicationLaunch: (id: string, approve: boolean) => Promise<string>
  resolveApplicationClose: (id: string, approve: boolean) => Promise<string>
  resolveLocationAccess: (id: string, approve: boolean) => Promise<string>
  onLocationAccessResolved: (listener: (resolution: LocationAccessResolution) => void) => () => void
  finishAgentTask: (taskId: string) => void
  onApplicationLaunchResolved: (listener: (resolution: ApplicationLaunchResolution) => void) => () => void
  onApplicationCloseResolved: (listener: (resolution: ApplicationCloseResolution) => void) => () => void
  setApiCredential: (integrationId: string, token: string) => Promise<void>
  clearApiCredential: (integrationId: string) => Promise<void>
  getApiCredentialStatuses: (integrationIds: string[]) => Promise<Record<string, boolean>>
  approveChange: (id: string) => Promise<void>
  updateChange: (id: string, content: string) => Promise<void>
  discardChange: (id: string) => Promise<void>
  onChangeResolved: (listener: (resolution: ChangeResolution) => void) => () => void
  cancelChat: (requestId: string) => void
  preloadSpeechModel: () => Promise<void>
  publishAssistantActivity: (activity: AssistantActivity) => void
  getAssistantActivity: () => Promise<AssistantActivity>
  onAssistantActivity: (listener: (activity: AssistantActivity) => void) => () => void
  beginFloatingDrag: (screenX: number, screenY: number) => void
  moveFloating: (screenX: number, screenY: number) => void
  endFloatingDrag: () => void
  openAssistant: () => void
  hideAssistant: () => void
  publishBubble: (text: string, changes?: PendingChange[], applicationLaunches?: PendingApplicationLaunch[], applicationCloses?: PendingApplicationClose[]) => void
  getBubbleContent: () => Promise<BubbleContent>
  onBubbleContent: (listener: (content: BubbleContent) => void) => () => void
  transcribeSpeech: (audio: Float32Array, language: string) => Promise<string>
  onSpeechProgress: (listener: (progress: SpeechProgress) => void) => () => void
}

declare global {
  interface Window {
    desktop: DesktopApi
  }
}
