import type { AssistantSettings } from '../../shared'

export const desktopControlTools = [
  {
    type: 'function',
    function: { name: 'open_application', description: 'Open an application from the user-configured allowlist.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Executable name, e.g. notepad.exe' } }, required: ['name'] } }
  },
  {
    type: 'function',
    function: { name: 'close_application', description: 'Close an application opened by this assistant during this session.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Executable name' } }, required: ['name'] } }
  },
  {
    type: 'function',
    function: { name: 'open_windows_settings', description: 'Open a Windows Settings page, including supported sub-settings for display, sound, Bluetooth, Wi-Fi, updates, apps, privacy, and personalization.', parameters: { type: 'object', properties: { page: { type: 'string', enum: ['home', 'display', 'display-advanced', 'night-light', 'sound', 'bluetooth', 'network', 'wifi', 'vpn', 'windows-update', 'windows-update-history', 'windows-update-options', 'installed-apps', 'startup-apps', 'default-apps', 'privacy', 'privacy-location', 'privacy-microphone', 'privacy-camera', 'personalization', 'personalization-background', 'personalization-colors', 'windows-security'] } }, required: ['page'] } }
  },
  {
    type: 'function',
    function: { name: 'open_explorer_location', description: 'Open a configured folder in Windows File Explorer. Use a folder alias or path; subfolders are available only when enabled for that location in Settings.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'A configured folder path or alias, optionally followed by a subfolder path when enabled' } }, required: ['path'] } }
  }
]

export function desktopControlEnabled(settings: AssistantSettings) {
  return settings.appControlEnabled
}

export const agentToolFeature = { tools: desktopControlTools, enabled: desktopControlEnabled }
