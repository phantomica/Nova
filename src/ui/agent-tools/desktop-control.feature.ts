import type { AssistantSettings } from '../../shared'

export const desktopControlTools = [
  {
    type: 'function',
    function: { name: 'open_application', description: 'Open a configured program by its display name or alias. Nova resolves executable names using PATH, registered Windows App Paths, and Start Menu shortcuts before launch. If the program is unlisted, Nova resolves candidates first and asks one-time approval for the exact executable path; if multiple candidates match, ask the user which exact path to use. Never report success unless the launch result confirms it.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Configured display name or alias, executable name, or exact executable path' } }, required: ['name'] } }
  },
  {
    type: 'function',
    function: { name: 'close_application', description: 'Gracefully close an installed executable application by its configured name or exact executable path. Allowlisted apps may be closed when the user explicitly asks. Unlisted apps require one-time approval. Nova sends a normal window-close request only and never force-kills a process; report clearly if the app has no closable window or refuses to close.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Configured display name or alias, executable name, or exact executable path' } }, required: ['name'] } }
  },
  {
    type: 'function',
    function: { name: 'open_windows_settings', description: 'Open a Windows Settings page, including supported sub-settings for display, sound, Bluetooth, Wi-Fi, updates, apps, privacy, and personalization.', parameters: { type: 'object', properties: { page: { type: 'string', enum: ['home', 'display', 'display-advanced', 'night-light', 'sound', 'bluetooth', 'network', 'wifi', 'vpn', 'windows-update', 'windows-update-history', 'windows-update-options', 'installed-apps', 'startup-apps', 'default-apps', 'privacy', 'privacy-location', 'privacy-microphone', 'privacy-camera', 'personalization', 'personalization-background', 'personalization-colors', 'windows-security'] } }, required: ['page'] } }
  },
  {
    type: 'function',
    function: { name: 'open_explorer_location', description: 'Open any existing folder in Windows File Explorer. This only opens the user-requested folder in Explorer; it does not grant Nova permission to list, read, or change files there. Provide an absolute folder path.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path to any existing folder' } }, required: ['path'] } }
  }
]

export function desktopControlEnabled(settings: AssistantSettings) {
  return settings.appControlEnabled
}

function getDesktopControlTools(settings: AssistantSettings) {
  const capabilityByTool: Record<string, boolean> = {
    open_application: settings.appLaunchEnabled,
    close_application: settings.appCloseEnabled,
    open_windows_settings: settings.windowsSettingsEnabled,
    open_explorer_location: settings.fileExplorerEnabled
  }
  return desktopControlTools.filter((definition) => {
    const tool = definition as { function?: { name?: string } }
    return tool.function?.name ? capabilityByTool[tool.function.name] : false
  })
}

export const agentToolFeature = { tools: desktopControlTools, enabled: desktopControlEnabled, getTools: getDesktopControlTools }
