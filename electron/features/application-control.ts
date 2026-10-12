import { shell } from 'electron'
import { spawn, execFile, type ExecFileOptions } from 'node:child_process'
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AllowedApplication, AssistantSettings } from '../../src/shared'

const appPathsRegistryRoots = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
]

export function hasUriScheme(value: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)
}

function validateApplicationRequest(requested: string) {
  const name = requested.trim()
  if (!name) throw new Error('Application name or path is required.')
  if (name.length > 500 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Application name or path is invalid.')
  return name
}

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

function matchingAllowedApplication(name: string, allowedApps: AllowedApplication[]) {
  return allowedApps.find((application) =>
    application.name.toLowerCase() === name.toLowerCase()
    || application.target.toLowerCase() === name.toLowerCase()
    || (!path.isAbsolute(name) && application.type === 'executable'
      && path.basename(application.target).toLowerCase() === path.basename(name).toLowerCase()))
}

export function isApplicationAllowed(requested: string, allowedApps: AllowedApplication[]) {
  const name = validateApplicationRequest(requested)
  return Boolean(matchingAllowedApplication(name, allowedApps))
}

function runFile(command: string, args: string[], options: ExecFileOptions = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr })
        reject(error)
      } else resolve({ stdout, stderr })
    })
  })
}

function executableNames(name: string) {
  const base = path.basename(name)
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  return path.extname(base) ? [base] : extensions.map((extension) => `${base}${extension.toLowerCase()}`)
}

async function pathCandidates(name: string) {
  const candidates = new Set<string>()
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const directory of directories) {
    for (const executable of executableNames(name)) {
      const candidate = path.resolve(directory, executable)
      if (existsSync(candidate) && statSync(candidate).isFile()) candidates.add(realpathSync(candidate))
    }
  }
  return candidates
}

async function appPathCandidates(name: string) {
  const candidates = new Set<string>()
  for (const root of appPathsRegistryRoots) {
    try {
      const { stdout } = await runFile('reg.exe', ['query', root, '/s'])
      let currentMatches = false
      for (const line of stdout.split(/\r?\n/)) {
        const key = /^\s*HKEY_[^\r\n]+\\([^\\]+)\s*$/i.exec(line)
        if (key) {
          currentMatches = executableNames(name).some((executable) => key[1].toLowerCase() === executable.toLowerCase())
          continue
        }
        if (!currentMatches) continue
        const value = /^\s*\(Default\)\s+REG_SZ\s+(.+?)\s*$/i.exec(line)
        if (!value) continue
        const target = value[1].replace(/^"|"$/g, '')
        if (path.isAbsolute(target) && existsSync(target) && statSync(target).isFile()) candidates.add(realpathSync(target))
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 1) throw error
    }
  }
  return candidates
}

function startMenuShortcuts() {
  const paths = [
    path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ].filter((directory) => directory && existsSync(directory))
  const shortcuts: Array<{ path: string; name: string }> = []
  let visited = 0
  const maxVisited = 5_000
  let truncated = false
  while (paths.length && visited < maxVisited) {
    const directory = paths.pop()!
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') continue
      throw error
    }
    for (const entry of entries) {
      visited += 1
      if (visited > maxVisited) {
        truncated = true
        break
      }
      const candidate = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) paths.push(candidate)
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.lnk') {
        shortcuts.push({ path: candidate, name: path.basename(entry.name, '.lnk') })
      }
    }
  }
  return { shortcuts, truncated: truncated || paths.length > 0 }
}

export async function findApplicationCandidates(requested: string) {
  const name = validateApplicationRequest(requested)
  if (path.isAbsolute(name)) {
    return existsSync(name) && statSync(name).isFile() ? [realpathSync(name)] : []
  }
  if (hasUriScheme(name)) return []
  const normalized = path.basename(name).replace(/\.(?:exe|com|bat|cmd)$/i, '').toLowerCase()
  const candidates = new Set<string>(await pathCandidates(name))
  for (const candidate of await appPathCandidates(name)) candidates.add(candidate)
  const startMenu = startMenuShortcuts()
  for (const shortcut of startMenu.shortcuts) {
    if (shortcut.name.toLowerCase() !== normalized) continue
    try {
      const details = shell.readShortcutLink(shortcut.path)
      if (path.isAbsolute(details.target) && existsSync(details.target) && statSync(details.target).isFile()) {
        candidates.add(realpathSync(details.target))
      }
    } catch (error) {
      console.warn(`Skipping unreadable Start Menu shortcut while resolving "${name}": ${shortcut.path}`, error)
    }
  }
  if (startMenu.truncated) throw new Error(`Start Menu program lookup reached its 5,000-entry limit while resolving "${name}". Specify the exact executable path or add it to the allowed programs list.`)
  return [...candidates].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
}

export async function resolveApplicationTarget(requested: string, allowedApps: AllowedApplication[]) {
  const name = validateApplicationRequest(requested)
  const allowedApp = matchingAllowedApplication(name, allowedApps)
  const target = allowedApp?.target ?? name
  if (allowedApp?.type === 'link') {
    if (!/^(?:spotify:|steam:)/i.test(target)) throw new Error('Only configured Spotify and Steam links are supported.')
    return { target, displayName: allowedApp.name, type: 'link' as const }
  }
  if (hasUriScheme(target)) {
    throw new Error('Unlisted application approval is limited to executable names and paths, not application links.')
  }
  const candidates = await findApplicationCandidates(target)
  if (!candidates.length) throw new Error(`Could not find "${name}" as an executable in PATH, Windows App Paths, or Start Menu shortcuts. Enter its full executable path or add a matching program in Settings.`)
  if (candidates.length > 1) throw new Error(`More than one installed program matches "${name}". Specify the exact executable path:\n${candidates.join('\n')}`)
  return { target: candidates[0], displayName: allowedApp?.name ?? name, type: 'executable' as const }
}

export async function openApplication(requested: string, allowedApps: AllowedApplication[]) {
  const resolved = await resolveApplicationTarget(requested, allowedApps)
  if (resolved.type === 'link') {
    await shell.openExternal(resolved.target)
    return `Opened ${resolved.displayName}.`
  }
  await spawnDetached(resolved.target)
  return `Opened ${resolved.displayName} (${resolved.target}).`
}

export async function closeApplication(requested: string, allowedApps: AllowedApplication[]) {
  const resolved = await resolveApplicationTarget(requested, allowedApps)
  if (resolved.type !== 'executable') throw new Error('Nova can close executable applications, not application links.')
  const script = [
    '$target = [System.IO.Path]::GetFullPath($env:NOVA_CLOSE_TARGET)',
    '$matches = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {',
    '  try { $_.MainWindowHandle -ne 0 -and $_.Path -and [System.IO.Path]::GetFullPath($_.Path) -ieq $target } catch { $false }',
    '})',
    '$results = @($matches | ForEach-Object { [pscustomobject]@{ Id = $_.Id; Title = $_.MainWindowTitle; Closed = $_.CloseMainWindow() } })',
    'if ($results.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject $results -Compress }'
  ].join('; ')
  const { stdout } = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: 10_000,
    env: { ...process.env, NOVA_CLOSE_TARGET: resolved.target }
  })
  const closed = JSON.parse(stdout.trim()) as Array<{ Id: number; Title: string; Closed: boolean }>
  if (!closed.length) throw new Error(`No open, closable window was found for ${resolved.displayName}. Nova did not force-close any process.`)
  const accepted = closed.filter((process) => process.Closed)
  if (!accepted.length) throw new Error(`${resolved.displayName} did not accept a graceful close request. Nova did not force-close it.`)
  return `Sent a graceful close request to ${accepted.length} ${resolved.displayName} window${accepted.length === 1 ? '' : 's'}.`
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

export async function openExplorerLocation(requested: string) {
  const name = requested.trim()
  if (!name) throw new Error('A folder path is required.')
  if (!path.isAbsolute(name)) throw new Error('File Explorer requires an absolute folder path.')
  if (!existsSync(name) || !statSync(name).isDirectory()) throw new Error(`Folder not found: ${name}`)
  const target = realpathSync(name)
  await spawnDetached('explorer.exe', [target])
  return `Opened ${target} in File Explorer.`
}
