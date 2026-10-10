import { app, BrowserWindow, dialog, ipcMain, safeStorage, Tray, Menu, nativeImage, screen, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { env, pipeline } from '@huggingface/transformers'
import type { ProgressInfo } from '@huggingface/transformers'
import type { ApiIntegration, AssistantActivity, AssistantSettings, BubbleContent, ChangeResolution, OllamaMessage, PendingApiAction, PendingChange, SpeechProgress } from '../src/shared'
import { configuredLocation, stopLaunchedApplications } from './features/application-control'
import { runFeatureTool } from './features/tool-registry'

const here = path.dirname(fileURLToPath(import.meta.url))
// Privileged operations and persistent settings stay in the main process; renderer windows use typed IPC.
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const apiCredentialsPath = path.join(app.getPath('userData'), 'api-credentials.json')
const floatingPositionPath = path.join(app.getPath('userData'), 'floating-position.json')
const chatPositionPath = path.join(app.getPath('userData'), 'chat-position.json')
const chatSizePath = path.join(app.getPath('userData'), 'chat-size.json')
const defaults: AssistantSettings = {
  themePreset: 'nova',
  accentColor: '#a5ed88',
  ollamaUrl: 'http://localhost:11434',
  model: 'gemma4',
  workspace: app.getPath('documents'),
  wakeWord: 'hey nova',
  wakeWordEnabled: false,
  rememberFloatingPosition: true,
  restoreChatWindowPosition: false,
  chatSizeBehavior: 'on-restart',
  interruptSpeechOnVoiceInput: true,
  speakReplies: true,
  speechVoice: '',
  speechLanguage: 'de-DE',
  speechRate: 1,
  bubbleDurationSeconds: 8,
  bubbleDurationMode: 'after-speech',
  confirmFileChanges: true,
  webSearchEnabled: true,
  fileOperationsEnabled: true,
  appControlEnabled: true,
  mediaControlEnabled: true,
  apiAccessEnabled: true,
  allowedApps: [
    'Discord=Discord.exe',
    'Firefox=firefox.exe',
    'Obsidian=Obsidian.exe',
    'Steam=steam.exe',
    'Spotify=spotify:',
    'VS Code=Code.exe'
  ],
  allowedFolders: [app.getPath('documents'), app.getPath('downloads'), app.getPath('desktop')],
  allowedFolderSubfolders: [],
  apiIntegrations: [],
  programDefaultsVersion: 1
}

function monitorWindow(window: BrowserWindow, label: string) {
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Failed to load Nova ${label} preload (${preloadPath}):`, error)
  })
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`Nova ${label} renderer failed to load (${code}): ${description} — ${url}`)
  })
  window.webContents.on('did-finish-load', () => {
    void window.webContents.executeJavaScript(`JSON.stringify({
      bridge: typeof window.desktop,
      localWhisper: typeof window.desktop?.transcribeSpeech,
      mediaDevices: typeof navigator.mediaDevices
    })`).then((capabilities: string) => {
      console.log(`Nova ${label} renderer capabilities: ${capabilities}`)
      const parsed = JSON.parse(capabilities) as { bridge: string; localWhisper: string }
      if (parsed.bridge !== 'object') console.error(`Nova ${label} preload loaded without exposing window.desktop.`)
      if (label === 'chat' && parsed.localWhisper !== 'function') console.error('Nova chat renderer is missing local Whisper support.')
    }).catch((error: unknown) => console.error(`Could not inspect Nova ${label} renderer:`, error))
  })
}

let settings = defaults
let mainWindow: BrowserWindow | undefined
let floatingWindow: BrowserWindow | undefined
let bubbleWindow: BrowserWindow | undefined
let folderPickerOpen = false
let tray: Tray | undefined
let latestBubble = ''
let latestBubbleChanges: PendingChange[] = []
let bubbleSide: BubbleContent['side'] = 'left'
let latestBubbleIsStatus = false
let assistantActivity: AssistantActivity = 'idle'
let pendingAssistantActivity: AssistantActivity = 'idle'
let wakeIndicatorUntil = 0
let isQuitting = false
let positionSaveTimer: NodeJS.Timeout | undefined
let chatPositionSaveTimer: NodeJS.Timeout | undefined
let bubbleHideTimer: NodeJS.Timeout | undefined
let thinkingBubbleTimer: NodeJS.Timeout | undefined
let floatingDragOrigin: { pointerX: number; pointerY: number; windowX: number; windowY: number } | undefined
let bubbleFallbackTimer: NodeJS.Timeout | undefined
const pendingChanges = new Map<string, PendingChange>()
const pendingApiActions = new Map<string, PendingApiAction>()
let apiCredentials: Record<string, string> = {}
const activeChatRequests = new Map<string, { senderId: number; controller: AbortController }>()

env.cacheDir = path.join(app.getPath('userData'), 'speech-model-cache')
env.allowRemoteModels = true
env.allowLocalModels = false

type WhisperPipeline = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>
let whisperPipelinePromise: Promise<WhisperPipeline> | undefined

function speechProgress(target: Electron.WebContents, info: ProgressInfo) {
  if (target.isDestroyed()) return
  const progress: SpeechProgress = { status: info.status }
  if ('file' in info && typeof info.file === 'string') progress.file = path.basename(info.file)
  if ('progress' in info && typeof info.progress === 'number') progress.progress = info.progress
  target.send('speech:progress', progress)
}

function loadWhisper(target: Electron.WebContents) {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = pipeline('automatic-speech-recognition', 'onnx-community/whisper-small', {
      dtype: 'q8',
      device: 'cpu',
      cache_dir: path.join(app.getPath('userData'), 'speech-model-cache'),
      progress_callback: (info) => speechProgress(target, info)
    }).catch((error: unknown) => {
      whisperPipelinePromise = undefined
      throw error
    })
  }
  return whisperPipelinePromise
}

function whisperLanguage(language: string) {
  if (language === 'auto') return undefined
  const tag = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(language) ? language : 'en-US'
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag.split('-')[0])?.toLowerCase() ?? 'english'
}

function loadSettings() {
  try {
    if (existsSync(settingsPath)) {
      const loaded = JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<AssistantSettings> & { rememberWindowPosition?: unknown }
      const loadedApps = Array.isArray(loaded.allowedApps) ? loaded.allowedApps.filter((item): item is string => typeof item === 'string') : undefined
      const rememberFloatingPosition = typeof loaded.rememberFloatingPosition === 'boolean'
        ? loaded.rememberFloatingPosition
        : typeof loaded.rememberWindowPosition === 'boolean' ? loaded.rememberWindowPosition : defaults.rememberFloatingPosition
      const allowedApps = (loaded.programDefaultsVersion ?? 0) < defaults.programDefaultsVersion!
        ? [...new Set([...(loadedApps ?? []), ...defaults.allowedApps])]
        : loadedApps ?? defaults.allowedApps
      settings = {
        ...defaults,
        ...loaded,
        themePreset: ['nova', 'midnight', 'dusk'].includes(loaded.themePreset ?? '') ? loaded.themePreset! : defaults.themePreset,
        accentColor: typeof loaded.accentColor === 'string' && /^#[\da-f]{6}$/i.test(loaded.accentColor) ? loaded.accentColor : defaults.accentColor,
        rememberFloatingPosition,
        restoreChatWindowPosition: typeof loaded.restoreChatWindowPosition === 'boolean' ? loaded.restoreChatWindowPosition : defaults.restoreChatWindowPosition,
        chatSizeBehavior: ['on-open', 'on-restart', 'never'].includes(loaded.chatSizeBehavior ?? '') ? loaded.chatSizeBehavior! : defaults.chatSizeBehavior,
        mediaControlEnabled: typeof loaded.mediaControlEnabled === 'boolean' ? loaded.mediaControlEnabled : defaults.mediaControlEnabled,
        allowedFolders: Array.isArray(loaded.allowedFolders) ? loaded.allowedFolders.filter((folder): folder is string => typeof folder === 'string') : defaults.allowedFolders,
        allowedFolderSubfolders: Array.isArray(loaded.allowedFolderSubfolders)
          ? loaded.allowedFolderSubfolders.filter((folder): folder is string => typeof folder === 'string')
          : defaults.allowedFolderSubfolders,
        allowedApps,
        programDefaultsVersion: defaults.programDefaultsVersion,
        apiAccessEnabled: typeof loaded.apiAccessEnabled === 'boolean' ? loaded.apiAccessEnabled : defaults.apiAccessEnabled,
        apiIntegrations: Array.isArray(loaded.apiIntegrations) ? loaded.apiIntegrations : []
      }
      try { validateApiIntegrations(settings.apiIntegrations) }
      catch (error) {
        console.error('Ignoring invalid API integration settings:', error)
        settings.apiIntegrations = []
      }
    }
  } catch (error) {
    console.error('Could not load assistant settings:', error)
  }
  loadApiCredentials()
}

function persistSettings(next: AssistantSettings) {
  if (!['nova', 'midnight', 'dusk'].includes(next.themePreset)) throw new Error('App theme preset is invalid.')
  if (typeof next.accentColor !== 'string' || !/^#[\da-f]{6}$/i.test(next.accentColor)) throw new Error('Accent color must be a six-digit hex color.')
  if (!next.ollamaUrl.startsWith('http://') && !next.ollamaUrl.startsWith('https://')) {
    throw new Error('Ollama URL must start with http:// or https://.')
  }
  if (!path.isAbsolute(next.workspace)) throw new Error('Workspace path must be absolute.')
  if (!Number.isFinite(next.speechRate) || next.speechRate < 0.5 || next.speechRate > 2) {
    throw new Error('Speech rate must be between 0.5× and 2×.')
  }
  if (!Number.isFinite(next.bubbleDurationSeconds) || next.bubbleDurationSeconds < 2 || next.bubbleDurationSeconds > 60) {
    throw new Error('Speech bubble duration must be between 2 and 60 seconds.')
  }
  if (next.bubbleDurationMode !== 'fixed' && next.bubbleDurationMode !== 'after-speech') {
    throw new Error('Speech bubble duration mode is invalid.')
  }
  if (typeof next.interruptSpeechOnVoiceInput !== 'boolean') {
    throw new Error('Voice-input speech interruption setting is invalid.')
  }
  if (typeof next.rememberFloatingPosition !== 'boolean' || typeof next.restoreChatWindowPosition !== 'boolean') {
    throw new Error('Window position settings are invalid.')
  }
  if (!['on-open', 'on-restart', 'never'].includes(next.chatSizeBehavior)) throw new Error('Chat window size behavior is invalid.')
  if (typeof next.apiAccessEnabled !== 'boolean') throw new Error('API access setting is invalid.')
  if (typeof next.mediaControlEnabled !== 'boolean') throw new Error('Windows media control setting is invalid.')
  if (!Array.isArray(next.allowedApps) || next.allowedApps.length > 100 || next.allowedApps.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > 500)) {
    throw new Error('Allowed applications must be a list of up to 100 non-empty names or paths.')
  }
  if (!Array.isArray(next.allowedFolders) || next.allowedFolders.length > 50) throw new Error('Configure no more than 50 Explorer locations.')
  for (const entry of next.allowedFolders) {
    if (typeof entry !== 'string' || entry.length > 1000) throw new Error('Explorer location entries must be paths up to 1,000 characters.')
    const { alias, target } = configuredLocation(entry)
    if (alias && !/^[\p{L}\p{N} _-]{1,60}$/u.test(alias)) throw new Error('Explorer location aliases may contain letters, numbers, spaces, _ and - only.')
    if (!path.isAbsolute(target)) throw new Error(`Explorer location must use an absolute path: ${target}`)
  }
  if (!Array.isArray(next.allowedFolderSubfolders) || next.allowedFolderSubfolders.length > 50) {
    throw new Error('Configure subfolder access for no more than 50 Explorer locations.')
  }
  const configuredFolderPaths = new Set(next.allowedFolders.map((entry) => path.resolve(configuredLocation(entry).target).toLowerCase()))
  for (const folder of next.allowedFolderSubfolders) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder) || !configuredFolderPaths.has(path.resolve(folder).toLowerCase())) {
      throw new Error('Subfolder access must refer to an approved File Explorer location.')
    }
  }
  validateApiIntegrations(next.apiIntegrations)
  mkdirSync(next.workspace, { recursive: true })
  if (!next.rememberFloatingPosition && existsSync(floatingPositionPath)) unlinkSync(floatingPositionPath)
  if (!next.restoreChatWindowPosition && existsSync(chatPositionPath)) unlinkSync(chatPositionPath)
  if (next.chatSizeBehavior !== 'never' && existsSync(chatSizePath)) unlinkSync(chatSizePath)
  settings = { ...next, ollamaUrl: next.ollamaUrl.replace(/\/+$/, ''), programDefaultsVersion: defaults.programDefaultsVersion }
  mkdirSync(path.dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  if (latestBubble && !latestBubbleIsStatus) {
    scheduleBubbleDismissal()
    scheduleBubbleFallback()
  }
  return settings
}

function validateApiIntegrations(integrations: ApiIntegration[]) {
  if (!Array.isArray(integrations) || integrations.length > 10) throw new Error('Configure no more than 10 API integrations.')
  const integrationIds = new Set<string>()
  const operationIds = new Set<string>()
  for (const integration of integrations) {
    if (!/^[a-zA-Z0-9_-]{1,24}$/.test(integration.id) || integrationIds.has(integration.id)) throw new Error('API integration IDs must be unique and use letters, numbers, _ or - (up to 24 characters).')
    integrationIds.add(integration.id)
    if (typeof integration.name !== 'string' || !integration.name.trim() || integration.name.length > 60) throw new Error('Each API integration needs a name of up to 60 characters.')
    let baseUrl: URL
    try { baseUrl = new URL(integration.baseUrl) }
    catch { throw new Error(`The base URL for ${integration.name} is invalid.`) }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error(`The base URL for ${integration.name} must be HTTP/HTTPS without credentials, query, or fragment.`)
    }

    if (typeof integration.enabled !== 'boolean' || typeof integration.requiresBearerToken !== 'boolean') {
      throw new Error(`API integration settings for ${integration.name} are invalid.`)
    }
    if (!Array.isArray(integration.operations) || integration.operations.length > 20) throw new Error(`Configure no more than 20 operations for ${integration.name}.`)
    for (const operation of integration.operations) {
      if (!/^[a-zA-Z0-9_-]{1,24}$/.test(operation.id) || operationIds.has(`${integration.id}:${operation.id}`)) {
        throw new Error(`Operation IDs for ${integration.name} must be unique and use letters, numbers, _ or -.`)
      }
      operationIds.add(`${integration.id}:${operation.id}`)
      if (!operation.name.trim() || operation.name.length > 60 || !operation.description.trim() || operation.description.length > 300) {
        throw new Error(`Every ${integration.name} operation needs a name and description (up to 60 and 300 characters).`)
      }
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(operation.method)) throw new Error(`HTTP method for ${operation.name} is invalid.`)
      if (!operation.path.startsWith('/') || operation.path.includes('?') || operation.path.includes('#') || operation.path.includes('..') || operation.path.includes('\\') || /[\u0000-\u001f]/.test(operation.path) || operation.path.length > 500) {
        throw new Error(`Path for ${operation.name} must be a safe relative API path beginning with /.`)
      }
      if (typeof operation.requireConfirmation !== 'boolean') throw new Error(`Confirmation setting for ${operation.name} is invalid.`)
    }
  }
}

function loadApiCredentials() {
  try {
    if (!existsSync(apiCredentialsPath)) return
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('Saved API credentials cannot be decrypted because OS encryption is unavailable.')
      return
    }
    apiCredentials = JSON.parse(safeStorage.decryptString(Buffer.from(readFileSync(apiCredentialsPath, 'utf8'), 'base64'))) as Record<string, string>
  } catch (error) {
    console.error('Could not load encrypted API credentials:', error)
    apiCredentials = {}
  }
}

function persistApiCredentials(next: Record<string, string>) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. API tokens cannot be saved safely.')
  mkdirSync(path.dirname(apiCredentialsPath), { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(next)).toString('base64')
  writeFileSync(apiCredentialsPath, encrypted, 'utf8')
  apiCredentials = next
}

function apiToolName(integrationId: string, operationId: string) {
  return `api_${integrationId}_${operationId}`
}

function findApiOperation(toolName: string) {
  for (const integration of settings.apiIntegrations) {
    for (const operation of integration.operations) {
      if (apiToolName(integration.id, operation.id) === toolName) return { integration, operation }
    }
  }
  return undefined
}

function resolveApiRequest(action: PendingApiAction) {
  // Re-check the saved operation at execution time; approvals must not authorize a changed endpoint.
  const integration = settings.apiIntegrations.find((item) => item.id === action.integrationId && item.enabled)
  const operation = integration?.operations.find((item) => item.id === action.operationId && item.method === action.method)
  if (!settings.apiAccessEnabled || !integration || !operation || integration.baseUrl !== action.baseUrl || operation.name !== action.operation || operation.path !== action.path) {
    throw new Error('This API operation is no longer enabled or configured as originally requested.')
  }
  const pathParams = action.arguments.pathParams
  if (pathParams !== undefined && (!pathParams || typeof pathParams !== 'object' || Array.isArray(pathParams))) throw new Error('API path parameters must be an object.')
  let endpointPath = operation.path.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_match, key: string) => {
    const value = (pathParams as Record<string, unknown> | undefined)?.[key]
    if (value === undefined || value === null || String(value).length > 500) throw new Error(`A value is required for API path parameter "${key}".`)
    if (!/^[a-zA-Z0-9._~-]+$/.test(String(value)) || String(value) === '.' || String(value) === '..') {
      throw new Error(`API path parameter "${key}" contains unsupported characters.`)
    }
    return encodeURIComponent(String(value))
  })
  if (/[{}]/.test(endpointPath)) throw new Error('API path contains an unsupported parameter placeholder.')
  const baseUrl = new URL(integration.baseUrl)
  const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`
  const url = new URL(`${basePath}${endpointPath.replace(/^\/+/, '')}`, baseUrl.origin)
  const query = action.arguments.query
  if (query !== undefined && (!query || typeof query !== 'object' || Array.isArray(query))) throw new Error('API query parameters must be an object.')
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(key) || !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 1000) {
      throw new Error('API query parameter is invalid.')
    }
    url.searchParams.set(key, String(value))
  }
  const body = action.arguments.body
  if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body))) throw new Error('API request body must be a JSON object.')
  const serializedBody = body === undefined ? undefined : JSON.stringify(body)
  if (serializedBody && serializedBody.length > 16_000) throw new Error('API request bodies are limited to 16 KB.')
  return { integration, operation, url, serializedBody }
}

async function executeApiAction(action: PendingApiAction) {
  const { integration, operation, url, serializedBody } = resolveApiRequest(action)
  const headers: Record<string, string> = { accept: 'application/json, text/plain;q=0.9' }
  if (serializedBody) headers['content-type'] = 'application/json'
  if (integration.requiresBearerToken) {
    const token = apiCredentials[integration.id]
    if (!token) throw new Error(`Add a bearer token for ${integration.name} in Settings before using this operation.`)
    headers.authorization = `Bearer ${token}`
  }
  const response = await fetch(url, {
    method: operation.method,
    headers,
    ...(serializedBody ? { body: serializedBody } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  })
  if (response.status >= 300 && response.status < 400) throw new Error('The API redirected the request. Redirects are blocked to protect credentials.')
  const reader = response.body?.getReader()
  let responseText = ''
  if (reader) {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 64 * 1024) {
        await reader.cancel()
        throw new Error('API response exceeded the 64 KB limit.')
      }
      chunks.push(value)
    }
    responseText = new TextDecoder().decode(Buffer.concat(chunks))
  }
  const result = responseText.trim().slice(0, 12_000)
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}${result ? `: ${result}` : '.'}`)
  return `HTTP ${response.status}${result ? `\n${result}` : '\n(empty response)'}`
}

function createWindow() {
  const preloadPath = path.resolve(here, '../preload/index.js')
  if (!existsSync(preloadPath)) throw new Error(`Nova preload bundle was not found: ${preloadPath}`)
  const savedSize = settings.chatSizeBehavior === 'never' ? readChatWindowSize() : undefined
  const requestedWidth = savedSize?.width ?? 430
  const requestedHeight = savedSize?.height ?? 690
  const savedPosition = settings.restoreChatWindowPosition ? readWindowPosition(chatPositionPath) : undefined
  const display = savedPosition
    ? screen.getDisplayMatching({ ...savedPosition, width: requestedWidth, height: requestedHeight })
    : screen.getPrimaryDisplay()
  const width = Math.min(requestedWidth, display.workArea.width)
  const height = Math.min(requestedHeight, display.workArea.height)
  const windowPosition = savedPosition
    ? clampToWorkArea(
      savedPosition.x,
      savedPosition.y,
      width,
      height,
      display.workArea
    )
    : undefined
  mainWindow = new BrowserWindow({
    width,
    height,
    ...windowPosition,
    minWidth: 370,
    minHeight: 500,
    show: false,
    title: 'Nova',
    backgroundColor: '#111311',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  monitorWindow(floatingWindow, 'floating icon')
  monitorWindow(mainWindow, 'chat')
  mainWindow.on('move', saveChatWindowBounds)
  mainWindow.on('resize', saveChatWindowBounds)
  mainWindow.on('blur', () => {
    if (!folderPickerOpen && mainWindow?.isVisible()) hideChat()
  })
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      hideChat()
    }
  })
  mainWindow.on('closed', () => { mainWindow = undefined })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(here, '../renderer/index.html'))
  }
}

function clampToWorkArea(x: number, y: number, width: number, height: number, area: Electron.Rectangle) {
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(y, area.y), area.y + area.height - height)
  }
}

function savedFloatingPosition() {
  const savedPosition = settings.rememberFloatingPosition ? readWindowPosition(floatingPositionPath) : undefined
  if (savedPosition) return savedPosition
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - 92, y: area.y + area.height - 108 }
}

function readWindowPosition(positionPath: string) {
  try {
    const value = JSON.parse(readFileSync(positionPath, 'utf8')) as { x?: number; y?: number }
    if (Number.isFinite(value.x) && Number.isFinite(value.y)) return { x: value.x as number, y: value.y as number }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`Could not read saved window position (${positionPath}):`, error)
  }
  return undefined
}

function writeWindowPosition(window: BrowserWindow, positionPath: string) {
  const { x, y } = window.getBounds()
  mkdirSync(path.dirname(positionPath), { recursive: true })
  writeFileSync(positionPath, JSON.stringify({ x, y }), 'utf8')
}

function readChatWindowSize() {
  try {
    const value = JSON.parse(readFileSync(chatSizePath, 'utf8')) as { width?: number; height?: number }
    if (Number.isFinite(value.width) && Number.isFinite(value.height)
      && value.width! >= 370 && value.width! <= 8192
      && value.height! >= 500 && value.height! <= 8192) {
      return { width: value.width!, height: value.height! }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not read Nova chat window size:', error)
  }
  return undefined
}

function saveChatWindowBounds() {
  if (!settings.restoreChatWindowPosition && settings.chatSizeBehavior !== 'never') {
    if (chatPositionSaveTimer) clearTimeout(chatPositionSaveTimer)
    chatPositionSaveTimer = undefined
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (chatPositionSaveTimer) clearTimeout(chatPositionSaveTimer)
  chatPositionSaveTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      if (settings.restoreChatWindowPosition) writeWindowPosition(mainWindow, chatPositionPath)
      if (settings.chatSizeBehavior === 'never') {
        const { width, height } = mainWindow.getBounds()
        mkdirSync(path.dirname(chatSizePath), { recursive: true })
        writeFileSync(chatSizePath, JSON.stringify({ width, height }), 'utf8')
      }
    } catch (error) {
      console.error('Could not save Nova chat window bounds:', error)
    }
  }, 200)
}

function saveFloatingPosition() {
  if (!settings.rememberFloatingPosition) {
    if (positionSaveTimer) clearTimeout(positionSaveTimer)
    positionSaveTimer = undefined
    return
  }
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  positionSaveTimer = setTimeout(() => {
    if (!settings.rememberFloatingPosition || !floatingWindow || floatingWindow.isDestroyed()) return
    try {
      writeWindowPosition(floatingWindow, floatingPositionPath)
    } catch (error) {
      console.error('Could not save floating icon position:', error)
    }
  }, 200)
}

function rendererUrl(view: 'floating' | 'bubble') {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', view)
    return url.toString()
  }
  return undefined
}

function scheduleBubbleDismissal() {
  if (bubbleHideTimer) clearTimeout(bubbleHideTimer)
  bubbleHideTimer = undefined
  if (latestBubbleIsStatus) return
  if (settings.bubbleDurationMode === 'after-speech' && settings.speakReplies && assistantActivity === 'speaking') return
  bubbleHideTimer = setTimeout(() => {
    bubbleHideTimer = undefined
    latestBubble = ''
    latestBubbleChanges = []
    bubbleWindow?.hide()
  }, settings.bubbleDurationSeconds * 1000)
}

function estimateSpeechDuration(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, words / (2.6 * settings.speechRate))
}

function scheduleBubbleFallback() {
  if (bubbleFallbackTimer) clearTimeout(bubbleFallbackTimer)
  bubbleFallbackTimer = undefined
  if (latestBubbleIsStatus || !latestBubble) return
  const responseDuration = settings.speakReplies && settings.bubbleDurationMode === 'after-speech'
    ? estimateSpeechDuration(latestBubble)
    : 0
  // This is a fallback for speech engines that fail to signal an end event.
  bubbleFallbackTimer = setTimeout(() => {
    bubbleFallbackTimer = undefined
    if (assistantActivity !== 'speaking' || settings.bubbleDurationMode === 'fixed') {
      if (latestBubbleIsStatus) return
      latestBubble = ''
      latestBubbleChanges = []
      bubbleWindow?.hide()
    }
  }, (responseDuration + settings.bubbleDurationSeconds) * 1000)
}

function sendBubbleContent() {
  bubbleWindow?.webContents.send('bubble:update', {
    text: latestBubble,
    side: bubbleSide,
    status: latestBubbleIsStatus,
    changes: latestBubbleChanges
  } satisfies BubbleContent)
}

function bubbleBounds() {
  if (!floatingWindow) return undefined
  const iconBounds = floatingWindow.getBounds()
  const display = screen.getDisplayMatching(iconBounds)
  const bubbleWidth = 310
  const area = display.workArea
  const bubbleHeight = latestBubbleIsStatus
    ? 78
    : Math.min(
      Math.max(154, estimateBubbleHeight(latestBubble) + latestBubbleChanges.length * 92),
      Math.max(154, Math.floor(area.height * 0.8))
    )
  const rightX = iconBounds.x + iconBounds.width + 10
  const preferredX = rightX + bubbleWidth <= area.x + area.width
    ? rightX
    : iconBounds.x - bubbleWidth - 10
  const position = clampToWorkArea(preferredX, iconBounds.y + iconBounds.height - bubbleHeight, bubbleWidth, bubbleHeight, area)
  bubbleSide = position.x > iconBounds.x ? 'right' : 'left'
  return { ...position, width: bubbleWidth, height: bubbleHeight }
}

function showBubble() {
  if (!latestBubble || mainWindow?.isVisible() || !floatingWindow) return
  const bounds = bubbleBounds()
  if (!bounds) return
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    bubbleWindow = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.resolve(here, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    bubbleWindow.on('blur', () => bubbleWindow?.hide())
    bubbleWindow.on('closed', () => { bubbleWindow = undefined })
    monitorWindow(bubbleWindow, 'speech bubble')
    const url = rendererUrl('bubble')
    if (url) void bubbleWindow.loadURL(url)
    else void bubbleWindow.loadFile(path.join(here, '../renderer/index.html'), { query: { view: 'bubble' } })
    bubbleWindow.webContents.once('did-finish-load', () => {
      sendBubbleContent()
      bubbleWindow?.showInactive()
      scheduleBubbleDismissal()
      scheduleBubbleFallback()
    })
  } else {
    bubbleWindow.setBounds(bounds)
    sendBubbleContent()
    bubbleWindow.showInactive()
    scheduleBubbleDismissal()
    scheduleBubbleFallback()
  }

}

function estimateBubbleHeight(text: string) {
  const charsPerLine = 49
  const lines = text.split('\n').reduce((total, paragraph) => total + Math.max(1, Math.ceil(paragraph.length / charsPerLine)), 0)
  return lines * 17 + 76
}

function hideBubble() {
  if (bubbleHideTimer) clearTimeout(bubbleHideTimer)
  bubbleHideTimer = undefined
  if (bubbleFallbackTimer) clearTimeout(bubbleFallbackTimer)
  bubbleFallbackTimer = undefined
  bubbleWindow?.hide()
}

function createFloatingWindow() {
  const savedPosition = savedFloatingPosition()
  const display = screen.getDisplayMatching({ ...savedPosition, width: 72, height: 72 })
  const position = clampToWorkArea(savedPosition.x, savedPosition.y, 72, 72, display.workArea)
  floatingWindow = new BrowserWindow({
    width: 72,
    height: 72,
    ...position,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.resolve(here, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  floatingWindow.setAlwaysOnTop(true, 'floating')
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  floatingWindow.on('move', saveFloatingPosition)
  floatingWindow.on('closed', () => { floatingWindow = undefined })
  const url = rendererUrl('floating')
  if (url) void floatingWindow.loadURL(url)
  else void floatingWindow.loadFile(path.join(here, '../renderer/index.html'), { query: { view: 'floating' } })
  floatingWindow.once('ready-to-show', () => floatingWindow?.show())
}

function openChat() {
  hideBubble()
  if (latestBubbleIsStatus) {
    latestBubble = ''
    latestBubbleIsStatus = false
  }
  if (!mainWindow) createWindow()
  if (settings.chatSizeBehavior === 'on-open' && mainWindow) mainWindow.setSize(430, 690)
  if (floatingWindow && mainWindow && (!settings.restoreChatWindowPosition || !readWindowPosition(chatPositionPath))) {
    const iconBounds = floatingWindow.getBounds()
    const display = screen.getDisplayMatching(iconBounds)
    const area = display.workArea
    const [currentWidth, currentHeight] = mainWindow.getSize()
    const width = Math.min(currentWidth, area.width)
    const height = Math.min(currentHeight, area.height)
    if (width !== currentWidth || height !== currentHeight) mainWindow.setSize(width, height)
    const position = clampToWorkArea(iconBounds.x - width + iconBounds.width, iconBounds.y + iconBounds.height - height, width, height, area)
    mainWindow.setPosition(position.x, position.y)
  }
  floatingWindow?.hide()
  mainWindow?.show()
  mainWindow?.focus()
}

function hideChat() {
  mainWindow?.hide()
  floatingWindow?.show()
  if (assistantActivity === 'thinking') {
    latestBubble = 'Thinking'
    latestBubbleChanges = []
    latestBubbleIsStatus = true
  }
  showBubble()
}

function setAssistantActivity(activity: AssistantActivity) {
  if (activity === 'wake-heard') wakeIndicatorUntil = Date.now() + 1_500
  if (
    Date.now() < wakeIndicatorUntil
    && (activity === 'listening' || activity === 'recognizing' || activity === 'idle')
  ) return
  const previousActivity = assistantActivity
  assistantActivity = activity
  floatingWindow?.webContents.send('assistant:activity', activity)
  if (previousActivity === 'speaking' && activity !== 'speaking' && settings.bubbleDurationMode === 'after-speech') {
    scheduleBubbleDismissal()
  }
  if (activity === 'speaking' && settings.bubbleDurationMode === 'after-speech') {
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer)
    bubbleHideTimer = undefined
    if (bubbleFallbackTimer) clearTimeout(bubbleFallbackTimer)
    bubbleFallbackTimer = undefined
  }
  if (mainWindow?.isVisible()) return
  if (activity === 'thinking') {
    latestBubble = 'Thinking'
    latestBubbleChanges = []
    latestBubbleIsStatus = true
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer)
    bubbleHideTimer = undefined
    if (bubbleFallbackTimer) clearTimeout(bubbleFallbackTimer)
    bubbleFallbackTimer = undefined
    showBubble()
  } else if (latestBubbleIsStatus) {
    latestBubble = ''
    latestBubbleChanges = []
    latestBubbleIsStatus = false
    hideBubble()
  }
}

function beginFloatingDrag(event: Electron.IpcMainEvent, screenX: number, screenY: number) {
  if (event.sender !== floatingWindow?.webContents || !floatingWindow || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return
  const { x, y } = floatingWindow.getBounds()
  floatingDragOrigin = { pointerX: screenX, pointerY: screenY, windowX: x, windowY: y }
}

function moveFloating(event: Electron.IpcMainEvent, screenX: number, screenY: number) {
  if (event.sender !== floatingWindow?.webContents || !floatingWindow || !floatingDragOrigin || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return
  const x = floatingDragOrigin.windowX + screenX - floatingDragOrigin.pointerX
  const y = floatingDragOrigin.windowY + screenY - floatingDragOrigin.pointerY
  const display = screen.getDisplayMatching({ x, y, width: 72, height: 72 })
  const position = clampToWorkArea(x, y, 72, 72, display.workArea)
  floatingWindow.setPosition(position.x, position.y)
  if (bubbleWindow?.isVisible()) {
    const bounds = bubbleBounds()
    if (bounds) {
      bubbleWindow.setBounds(bounds)
      sendBubbleContent()
    }
  }
}

function toggleChat() {
  if (mainWindow?.isVisible()) hideChat()
  else openChat()
}

function safeWorkspacePath(relativePath: string) {
  const root = path.resolve(settings.workspace)
  const resolved = path.resolve(root, relativePath)
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('File path must stay inside your configured workspace.')
  }
  // Resolve the nearest existing ancestor so new files cannot escape through a symlinked parent.
  const realRoot = realpathSync(root)
  let existingParent = resolved
  while (!existsSync(existingParent)) {
    const parent = path.dirname(existingParent)
    if (parent === existingParent) throw new Error('Could not resolve the file path inside your workspace.')
    existingParent = parent
  }
  const realParent = realpathSync(existingParent)
  const relativeToRoot = path.relative(realRoot, realParent)
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    throw new Error('File path must stay inside your configured workspace, including through symbolic links.')
  }
  return resolved
}

function listWorkspaceFiles() {
  const root = realpathSync(settings.workspace)
  const files: string[] = []
  const visit = (directory: string, depth: number) => {
    if (depth > 5 || files.length >= 200) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= 200) break
      if (entry.isSymbolicLink() || entry.name === '.git' || entry.name === 'node_modules') continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target, depth + 1)
      else if (entry.isFile() && !/^\.env(?:\.|$)/i.test(entry.name)) files.push(path.relative(root, target))
    }
  }
  visit(root, 0)
  return { files, truncated: files.length >= 200 }
}

async function stageWorkspaceChange(args: Record<string, unknown>) {
  const relativePath = String(args.path ?? '')
  const operation = String(args.operation ?? '')
  const target = safeWorkspacePath(relativePath)
  if (!['create', 'edit', 'delete'].includes(operation)) throw new Error('File operation must be create, edit, or delete.')
  const exists = existsSync(target)
  if (operation === 'create' && exists) throw new Error('That file already exists; use edit instead.')
  if ((operation === 'edit' || operation === 'delete') && !exists) throw new Error('That file does not exist.')
  const before = exists ? readFileSync(target, 'utf8') : null
  const after = operation === 'delete' ? null : String(args.content ?? '')
  const change: PendingChange = { id: randomUUID(), path: relativePath, operation: operation as PendingChange['operation'], before, after, createdAt: Date.now() }
  if (settings.confirmFileChanges) {
    pendingChanges.set(change.id, change)
    return { result: `Staged ${operation} for ${relativePath}. The user must approve it before the original file changes.`, change }
  }
  if (operation === 'delete') unlinkSync(target)
  else {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, after ?? '', 'utf8')
  }
  return { result: `${operation} completed for ${relativePath}.` }
}

async function requestOllama(url: string, endpoint: string, body?: object, signal?: AbortSignal) {
  const response = await fetch(`${url.replace(/\/+$/, '')}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Ollama returned ${response.status}: ${detail.slice(0, 300)}`)
  }
  return response.json()
}

function registerIpc() {
  ipcMain.handle('settings:get', (event) => {
    if (![mainWindow, floatingWindow, bubbleWindow].some((window) => window?.webContents === event.sender)) {
      throw new Error('Settings are available only in Nova windows.')
    }
    return settings
  })
  ipcMain.handle('settings:save', (event, next: AssistantSettings) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Settings can be changed only in the Nova chat window.')
    const saved = persistSettings(next)
    const validIds = new Set(saved.apiIntegrations.map((integration) => integration.id))
    const nextCredentials = Object.fromEntries(Object.entries(apiCredentials).filter(([id]) => validIds.has(id)))
    if (Object.keys(nextCredentials).length !== Object.keys(apiCredentials).length) persistApiCredentials(nextCredentials)
    for (const window of [mainWindow, floatingWindow, bubbleWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('settings:updated', saved)
    }
    return saved
  })
  ipcMain.handle('folder:pick', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Folders can be selected only in the Nova chat window.')
    const parent = mainWindow
    if (!parent || parent.isDestroyed()) throw new Error('The Nova chat window is unavailable.')
    folderPickerOpen = true
    try {
      const result = await dialog.showOpenDialog(parent, {
        title: 'Choose an approved File Explorer location',
        properties: ['openDirectory', 'createDirectory']
      })
      return result.canceled ? undefined : result.filePaths[0]
    } finally {
      folderPickerOpen = false
    }
  })
  ipcMain.handle('api:credential:statuses', (event, integrationIds: string[]) => {
    if (event.sender !== mainWindow?.webContents || !Array.isArray(integrationIds)) throw new Error('API credential status request is invalid.')
    return Object.fromEntries(integrationIds.map((id) => [id, Boolean(apiCredentials[id])]))
  })
  ipcMain.handle('api:credential:set', (event, integrationId: string, token: string) => {
    if (event.sender !== mainWindow?.webContents || !settings.apiIntegrations.some((integration) => integration.id === integrationId)) {
      throw new Error('API credential request is invalid.')
    }
    if (typeof token !== 'string' || token.length > 8_000) throw new Error('API bearer tokens must be 8,000 characters or fewer.')
    if (!token.trim()) throw new Error('Enter a bearer token or clear the saved token.')
    persistApiCredentials({ ...apiCredentials, [integrationId]: token.trim() })
  })
  ipcMain.handle('api:credential:clear', (event, integrationId: string) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('API credential request is invalid.')
    const next = { ...apiCredentials }
    delete next[integrationId]
    persistApiCredentials(next)
  })
  ipcMain.handle('speech:preload', async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Speech model is available only in the Nova chat window.')
    await loadWhisper(event.sender)
  })
  ipcMain.handle('speech:transcribe', async (event, audio: Float32Array, language: string) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Speech transcription is available only in the Nova chat window.')
    if (!(audio instanceof Float32Array) || audio.length < 1600 || audio.length > 16000 * 120) {
      throw new Error('Speech recording must be between 0.1 seconds and 2 minutes long.')
    }
    if (audio.some((sample) => !Number.isFinite(sample))) throw new Error('Speech recording contains invalid audio data.')
    const transcriber = await loadWhisper(event.sender)
    const result = await transcriber(audio, {
      language: whisperLanguage(language),
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5
    })
    return result.text.trim()
  })
  ipcMain.handle('ollama:models', async (event, url: string) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Ollama models are available only in the Nova chat window.')
    const data = await requestOllama(url, '/api/tags')
    return (data.models ?? []).map((model: { name: string }) => model.name)
  })
  ipcMain.handle('ollama:chat', async (event, requestId: string, url: string, model: string, messages: OllamaMessage[], tools: object[]) => {
    if (event.sender !== mainWindow?.webContents || !requestId) throw new Error('Chat request is invalid.')
    const controller = new AbortController()
    activeChatRequests.set(requestId, { senderId: event.sender.id, controller })
    try {
      const data = await requestOllama(url, '/api/chat', { model, messages, tools, stream: false }, controller.signal)
      return data.message as OllamaMessage
    } finally {
      if (activeChatRequests.get(requestId)?.controller === controller) activeChatRequests.delete(requestId)
    }
  })
  ipcMain.on('ollama:cancel', (event, requestId: string) => {
    const request = activeChatRequests.get(requestId)
    if (request?.senderId === event.sender.id) request.controller.abort()
  })
  // This is the privileged action boundary: validate the caller, feature gate, and arguments here.
  ipcMain.handle('tool:run', async (event, name: string, args: Record<string, unknown>) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Agent actions are available only in the Nova chat window.')
    const apiOperation = findApiOperation(name)
    if (apiOperation) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('API action arguments must be an object.')
      const { integration, operation } = apiOperation
      if (!settings.apiAccessEnabled || !integration.enabled) throw new Error(`${integration.name} API access is disabled in Settings.`)
      if (integration.requiresBearerToken && !apiCredentials[integration.id]) {
        throw new Error(`Add a bearer token for ${integration.name} in Settings before using this operation.`)
      }
      const action: PendingApiAction = {
        id: randomUUID(),
        integrationId: integration.id,
        operationId: operation.id,
        integration: integration.name,
        baseUrl: integration.baseUrl,
        operation: operation.name,
        method: operation.method,
        path: operation.path,
        arguments: args ?? {}
      }
      resolveApiRequest(action)
      if (operation.requireConfirmation) {
        if (pendingApiActions.size >= 100) throw new Error('Too many API actions are awaiting approval. Resolve or deny some pending actions first.')
        pendingApiActions.set(action.id, action)
        return { result: `${integration.name}: ${operation.name} is waiting for user approval. Do not claim that it has completed.`, apiAction: action }
      }
      return { result: `${integration.name}: ${operation.name} completed.\n${await executeApiAction(action)}` }
    }
    return runFeatureTool(name, args, {
      settings,
      listWorkspaceFiles,
      safeWorkspacePath,
      stageFileChange: stageWorkspaceChange
    })
  })
  ipcMain.handle('api:resolve', async (event, id: string, approve: boolean) => {
    if (event.sender !== mainWindow?.webContents || typeof approve !== 'boolean') throw new Error('API action resolution request is invalid.')
    const action = pendingApiActions.get(id)
    if (!action) throw new Error('This API action is no longer pending.')
    if (!approve) {
      pendingApiActions.delete(id)
      return 'Denied. The API was not called.'
    }
    const result = await executeApiAction(action)
    pendingApiActions.delete(id)
    return result
  })
  const isAssistantWindow = (sender: Electron.WebContents) =>
    sender === mainWindow?.webContents || sender === bubbleWindow?.webContents
  const resolveBubbleChange = (id: string, action: ChangeResolution['action']) => {
    latestBubbleChanges = latestBubbleChanges.filter((change) => change.id !== id)
    sendBubbleContent()
    mainWindow?.webContents.send('change:resolved', { id, action } satisfies ChangeResolution)
  }
  ipcMain.handle('change:approve', (event, id: string) => {
    if (!isAssistantWindow(event.sender)) throw new Error('This file change request is invalid.')
    const change = pendingChanges.get(id)
    if (!change) throw new Error('This file change is no longer pending.')
    const target = safeWorkspacePath(change.path)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current !== change.before) throw new Error('The original file changed since this proposal was created. Review the file and ask Nova to prepare a fresh change.')
    if (change.operation === 'delete') {
      if (existsSync(target)) unlinkSync(target)
    } else {
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, change.after ?? '', 'utf8')
    }
    pendingChanges.delete(id)
    resolveBubbleChange(id, 'approved')
  })
  ipcMain.handle('change:update', (event, id: string, content: string) => {
    if (!isAssistantWindow(event.sender)) throw new Error('This file change request is invalid.')
    const change = pendingChanges.get(id)
    if (!change || change.operation === 'delete') throw new Error('This file change cannot be edited.')
    change.after = content
    latestBubbleChanges = latestBubbleChanges.map((bubbleChange) => bubbleChange.id === id ? { ...bubbleChange, after: content } : bubbleChange)
    sendBubbleContent()
  })
  ipcMain.handle('change:discard', (event, id: string) => {
    if (!isAssistantWindow(event.sender)) throw new Error('This file change request is invalid.')
    pendingChanges.delete(id)
    resolveBubbleChange(id, 'denied')
  })
  ipcMain.handle('bubble:get', (event): BubbleContent => {
    if (event.sender !== bubbleWindow?.webContents) throw new Error('Bubble content is available only in the speech bubble.')
    return { text: latestBubble, side: bubbleSide, status: latestBubbleIsStatus, changes: latestBubbleChanges }
  })
  ipcMain.handle('assistant:activity:get', (): AssistantActivity => assistantActivity)
  ipcMain.on('assistant:activity', (event, activity: AssistantActivity) => {
    if (event.sender !== mainWindow?.webContents) return
    if (!['idle', 'listening', 'wake-heard', 'recognizing', 'thinking', 'speaking'].includes(activity)) return
    pendingAssistantActivity = activity
    if (thinkingBubbleTimer) clearTimeout(thinkingBubbleTimer)
    thinkingBubbleTimer = undefined
    if (activity === 'thinking') {
      thinkingBubbleTimer = setTimeout(() => {
        thinkingBubbleTimer = undefined
        if (pendingAssistantActivity === 'thinking') setAssistantActivity('thinking')
      }, 450)
      return
    }
    setAssistantActivity(activity)
  })
  ipcMain.on('assistant:drag-start', beginFloatingDrag)
  ipcMain.on('assistant:drag-move', moveFloating)
  ipcMain.on('assistant:drag-end', (event) => {
    if (event.sender === floatingWindow?.webContents) floatingDragOrigin = undefined
  })
  ipcMain.on('bubble:publish', (event, text: string, changes?: PendingChange[]) => {
    if (event.sender !== mainWindow?.webContents || typeof text !== 'string') return
    latestBubble = text
    latestBubbleChanges = Array.isArray(changes)
      ? changes.flatMap((change) => {
        const pending = typeof change?.id === 'string' ? pendingChanges.get(change.id) : undefined
        return pending ? [pending] : []
      })
      : []
    latestBubbleIsStatus = false
    if (!mainWindow?.isVisible()) showBubble()
    else sendBubbleContent()
    scheduleBubbleFallback()
  })
  ipcMain.on('assistant:open', openChat)
  ipcMain.on('assistant:hide', hideChat)

}

app.whenReady().then(() => {
  loadSettings()
  registerIpc()
  const assistantSession = session.defaultSession
  assistantSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = webContents === mainWindow?.webContents
      && permission === 'media'
      && 'mediaTypes' in details
      && details.mediaTypes?.length === 1
      && details.mediaTypes[0] === 'audio'
    callback(Boolean(allowed))
  })
  assistantSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    webContents === mainWindow?.webContents && permission === 'media' && details.mediaType === 'audio')
  createFloatingWindow()
  createWindow()
  void loadWhisper(mainWindow.webContents).catch((error: unknown) => {
    console.error('Could not preload Nova Whisper model:', error)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('speech:progress', { status: 'error', message: error instanceof Error ? error.message : 'Could not load the local speech model.' } satisfies SpeechProgress)
    }
  })
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="10" fill="#a6f28a"/><path d="M10 17c0-4 2-7 6-7s6 3 6 7v4h-3v-4c0-2-1-4-3-4s-3 2-3 4v4h-3z" fill="#151714"/></svg>')}`)
  tray = new Tray(icon)
  tray.setToolTip('Nova · Desktop AI')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Nova', click: openChat },
    { label: 'Quit', click: () => app.quit() }
  ]))
  tray.on('click', toggleChat)
  app.on('activate', openChat)
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => {
  isQuitting = true
  if (positionSaveTimer) clearTimeout(positionSaveTimer)
  if (chatPositionSaveTimer) clearTimeout(chatPositionSaveTimer)
  if (settings.rememberFloatingPosition && floatingWindow && !floatingWindow.isDestroyed()) {
    try { writeWindowPosition(floatingWindow, floatingPositionPath) }
    catch (error) { console.error('Could not save floating icon position:', error) }
  }
  if (settings.restoreChatWindowPosition && mainWindow && !mainWindow.isDestroyed()) {
    try { writeWindowPosition(mainWindow, chatPositionPath) }
    catch (error) { console.error('Could not save Nova chat window position:', error) }
  }
  if (settings.chatSizeBehavior === 'never' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      const { width, height } = mainWindow.getBounds()
      mkdirSync(path.dirname(chatSizePath), { recursive: true })
      writeFileSync(chatSizePath, JSON.stringify({ width, height }), 'utf8')
    } catch (error) { console.error('Could not save Nova chat window size:', error) }
  }
  stopLaunchedApplications()
})
