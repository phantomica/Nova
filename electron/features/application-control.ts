import { shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

const launchedApplications = new Map<string, ChildProcess>()

function spawnDetached(command: string, args: string[] = []) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  return new Promise<ChildProcess>((resolve, reject) => {
    child.once('spawn', () => {
      child.unref()
      resolve(child)
    })
    child.once('error', reject)
  })
}

export async function openApplication(requested: string, allowedApps: string[]) {
  const name = requested.trim()
  if (!name) throw new Error('Application name or path is required.')
  const requestedIsPath = path.isAbsolute(name)
  const entries = allowedApps.map((raw) => {
    const separator = raw.indexOf('=')
    return separator > 0
      ? { name: raw.slice(0, separator).trim(), target: raw.slice(separator + 1).trim() }
      : { name: path.basename(raw.trim()), target: raw.trim() }
  })
  const allowedApp = entries.find(({ name: alias, target }) =>
    alias.toLowerCase() === name.toLowerCase()
    || target.toLowerCase() === name.toLowerCase()
    || (!requestedIsPath && !/^[a-z][a-z\d+.-]*:/i.test(target) && path.basename(target).toLowerCase() === path.basename(name).toLowerCase()))
  if (!allowedApp) throw new Error(`${name} is not in your allowed apps list.`)
  const appTarget = path.isAbsolute(allowedApp.target) ? path.resolve(allowedApp.target) : allowedApp.target
  const appKey = allowedApp.name.toLowerCase()
  if (/^(?:spotify:|steam:)/i.test(appTarget)) {
    await shell.openExternal(appTarget)
    return `Opened ${allowedApp.name}.`
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(appTarget)) throw new Error('Only configured Spotify and Steam application links are supported.')
  const child = await spawnDetached(appTarget)
  launchedApplications.set(appKey, child)
  return `Opened ${appTarget}.`
}

export function closeApplication(requested: string) {
  const name = requested.trim()
  const matches = [...launchedApplications.keys()].filter((key) => key === name.toLowerCase())
  if (matches.length > 1) throw new Error(`More than one launched application matches ${name}; provide its full path.`)
  const appKey = matches[0]
  const child = appKey ? launchedApplications.get(appKey) : undefined
  if (!child || child.killed) throw new Error(`Nova can only close an app that it opened during this session (${name || 'unknown app'}).`)
  child.kill()
  launchedApplications.delete(appKey)
  return `Closed ${name}.`
}

export async function openWindowsSettings(page: string) {
  const pages: Record<string, string> = {
    home: 'ms-settings:',
    display: 'ms-settings:display',
    'display-advanced': 'ms-settings:display-advanced',
    'night-light': 'ms-settings:nightlight',
    sound: 'ms-settings:sound',
    bluetooth: 'ms-settings:bluetooth',
    network: 'ms-settings:network',
    wifi: 'ms-settings:network-wifi',
    vpn: 'ms-settings:network-vpn',
    'windows-update': 'ms-settings:windowsupdate',
    'windows-update-history': 'ms-settings:windowsupdate-history',
    'windows-update-options': 'ms-settings:windowsupdate-options',
    'installed-apps': 'ms-settings:appsfeatures',
    'startup-apps': 'ms-settings:startupapps',
    'default-apps': 'ms-settings:defaultapps',
    privacy: 'ms-settings:privacy',
    'privacy-location': 'ms-settings:privacy-location',
    'privacy-microphone': 'ms-settings:privacy-microphone',
    'privacy-camera': 'ms-settings:privacy-webcam',
    personalization: 'ms-settings:personalization',
    'personalization-background': 'ms-settings:personalization-background',
    'personalization-colors': 'ms-settings:personalization-colors',
    'windows-security': 'windowsdefender:'
  }
  const target = pages[page]
  if (!target) throw new Error('That Windows Settings page is not supported.')
  await shell.openExternal(target)
  return `Opened Windows Settings: ${page}.`
}

export function configuredLocation(entry: string) {
  const separator = entry.indexOf('=')
  const alias = separator > 0 ? entry.slice(0, separator).trim() : ''
  const target = separator > 0 ? entry.slice(separator + 1).trim() : entry.trim()
  return { alias, target }
}

export async function openExplorerLocation(requested: string, allowedFolders: string[]) {
  const name = requested.trim()
  const allowed = allowedFolders.map(configuredLocation).find(({ alias, target }) =>
    (alias && alias.toLowerCase() === name.toLowerCase())
    || path.resolve(target).toLowerCase() === path.resolve(name).toLowerCase())
  if (!name || !allowed) throw new Error('That folder is not in the configured Explorer locations list.')
  const target = realpathSync(allowed.target)
  if (!statSync(target).isDirectory()) throw new Error('The configured Explorer location is not a folder.')
  await spawnDetached('explorer.exe', [target])
  return `Opened ${target} in File Explorer.`
}

export function stopLaunchedApplications() {
  for (const child of launchedApplications.values()) child.kill()
  launchedApplications.clear()
}
