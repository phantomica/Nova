import { contextBridge, ipcRenderer } from 'electron'
import type { ApplicationLaunchResolution, AssistantActivity, AssistantSettings, BubbleContent, ChangeResolution, DesktopApi, OllamaMessage, SpeechProgress } from '../src/shared'

const desktop: DesktopApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AssistantSettings) => ipcRenderer.invoke('settings:save', settings),
  pickFolder: () => ipcRenderer.invoke('folder:pick'),
  onSettingsUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AssistantSettings) => listener(settings)
    ipcRenderer.on('settings:updated', handler)
    return () => ipcRenderer.removeListener('settings:updated', handler)
  },
  listModels: (url: string) => ipcRenderer.invoke('ollama:models', url),
  chat: (requestId, url, model, messages, tools) =>
    ipcRenderer.invoke('ollama:chat', requestId, url, model, messages, tools),
  cancelChat: (requestId) => ipcRenderer.send('ollama:cancel', requestId),
  preloadSpeechModel: () => ipcRenderer.invoke('speech:preload'),
  publishAssistantActivity: (activity: AssistantActivity) => ipcRenderer.send('assistant:activity', activity),
  getAssistantActivity: () => ipcRenderer.invoke('assistant:activity:get'),
  onAssistantActivity: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, activity: AssistantActivity) => listener(activity)
    ipcRenderer.on('assistant:activity', handler)
    return () => ipcRenderer.removeListener('assistant:activity', handler)
  },
  beginFloatingDrag: (screenX, screenY) => ipcRenderer.send('assistant:drag-start', screenX, screenY),
  moveFloating: (screenX, screenY) => ipcRenderer.send('assistant:drag-move', screenX, screenY),
  endFloatingDrag: () => ipcRenderer.send('assistant:drag-end'),
  runTool: (name, args) => ipcRenderer.invoke('tool:run', name, args),
  resolveApiAction: (id, approve) => ipcRenderer.invoke('api:resolve', id, approve),
  resolveApplicationLaunch: (id, approve) => ipcRenderer.invoke('application:resolve-launch', id, approve),
  onApplicationLaunchResolved: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, resolution: ApplicationLaunchResolution) => listener(resolution)
    ipcRenderer.on('application:launch-resolved', handler)
    return () => ipcRenderer.removeListener('application:launch-resolved', handler)
  },
  setApiCredential: (integrationId, token) => ipcRenderer.invoke('api:credential:set', integrationId, token),
  clearApiCredential: (integrationId) => ipcRenderer.invoke('api:credential:clear', integrationId),
  getApiCredentialStatuses: (integrationIds) => ipcRenderer.invoke('api:credential:statuses', integrationIds),
  approveChange: (id) => ipcRenderer.invoke('change:approve', id),
  updateChange: (id, content) => ipcRenderer.invoke('change:update', id, content),
  discardChange: (id) => ipcRenderer.invoke('change:discard', id),
  onChangeResolved: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, resolution: ChangeResolution) => listener(resolution)
    ipcRenderer.on('change:resolved', handler)
    return () => ipcRenderer.removeListener('change:resolved', handler)
  },
  openAssistant: () => ipcRenderer.send('assistant:open'),
  hideAssistant: () => ipcRenderer.send('assistant:hide'),
  publishBubble: (text, changes, applicationLaunches) => ipcRenderer.send('bubble:publish', text, changes, applicationLaunches),
  getBubbleContent: () => ipcRenderer.invoke('bubble:get'),
  onBubbleContent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, content: BubbleContent) => listener(content)
    ipcRenderer.on('bubble:update', handler)
    return () => ipcRenderer.removeListener('bubble:update', handler)
  },
  transcribeSpeech: (audio, language) => ipcRenderer.invoke('speech:transcribe', audio, language),
  onSpeechProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SpeechProgress) => listener(progress)
    ipcRenderer.on('speech:progress', handler)
    return () => ipcRenderer.removeListener('speech:progress', handler)
  }
}
contextBridge.exposeInMainWorld('desktop', desktop)
