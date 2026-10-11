import { existsSync, realpathSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { AssistantSettings } from '../../src/shared'

type AllowedRoot = { path: string; recursive: boolean; label: string }

function allowedRoots(settings: AssistantSettings, temporaryRoots: string[] = []): AllowedRoot[] {
  const roots: AllowedRoot[] = [{ path: path.resolve(settings.workspace), recursive: settings.workspaceSubfolders, label: 'Workspace' }]
  for (const entry of settings.allowedFolders) {
    const separator = entry.indexOf('=')
    const label = separator > 0 ? entry.slice(0, separator).trim() : entry
    const target = separator > 0 ? entry.slice(separator + 1).trim() : entry.trim()
    const root = path.resolve(target)
    roots.push({
      path: root,
      recursive: settings.allowedFolderSubfolders.some((folder) => path.resolve(folder).toLowerCase() === root.toLowerCase()),
      label
    })
  }
  for (const root of temporaryRoots) {
    const resolved = path.resolve(root)
    if (existsSync(resolved) && statSync(resolved).isDirectory()
      && realpathSync(resolved).toLowerCase() !== resolved.toLowerCase()) {
      throw new Error(`Temporary access folder changed after approval: ${resolved}`)
    }
    roots.push({ path: resolved, recursive: true, label: 'Temporary task access' })
  }
  const unique = new Map<string, AllowedRoot>()
  for (const root of roots) {
    const key = root.path.toLowerCase()
    const existing = unique.get(key)
    unique.set(key, existing
      ? { ...existing, recursive: existing.recursive || root.recursive }
      : root)
  }
  return [...unique.values()]
}

function containsPath(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function resolveRequestedDirectoryPath(settings: AssistantSettings, requestedPath: string) {
  const requested = requestedPath.trim()
  if (!requested) return path.resolve(settings.workspace)
  if (path.isAbsolute(requested)) return path.resolve(requested)
  const matchingAlias = settings.allowedFolders.map((entry) => {
    const separator = entry.indexOf('=')
    return separator > 0 ? { alias: entry.slice(0, separator).trim(), target: entry.slice(separator + 1).trim() } : undefined
  }).find((location) => location?.alias && (
    location.alias.toLowerCase() === requested.toLowerCase()
    || (requested.length > location.alias.length
      && requested.slice(0, location.alias.length).toLowerCase() === location.alias.toLowerCase()
      && ['\\', '/'].includes(requested[location.alias.length]))
  ))
  if (matchingAlias) {
    const suffix = requested.slice(matchingAlias.alias.length).replace(/^[\\/]+/, '')
    return path.resolve(matchingAlias.target, suffix)
  }
  return path.resolve(settings.workspace, requested)
}

export function resolveAllowedFilePath(settings: AssistantSettings, requestedPath: string, temporaryRoots: string[] = []) {
  const requested = requestedPath.trim()
  if (!requested) throw new Error('A file path is required.')
  const resolved = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(settings.workspace, requested)
  const roots = allowedRoots(settings, temporaryRoots).flatMap((root) => {
    const locations = [{ root, base: root.path }]
    if (existsSync(root.path) && statSync(root.path).isDirectory()) {
      const realRoot = realpathSync(root.path)
      if (realRoot.toLowerCase() !== root.path.toLowerCase()) locations.push({ root, base: realRoot })
    }
    return locations.filter(({ base }) => containsPath(base, resolved))
  }).sort((left, right) => right.base.length - left.base.length)
  const root = roots.find(({ root: candidate, base }) => {
    const relative = path.relative(base, resolved)
    return relative !== '' && (candidate.recursive || !relative.includes(path.sep))
  })
  if (!root) throw new Error('File path must be inside your workspace or an approved file location with the required subfolder access.')
  if (!existsSync(root.root.path) || !statSync(root.root.path).isDirectory()) {
    throw new Error(`Approved file location is not available: ${root.root.path}`)
  }

  const realRoot = realpathSync(root.root.path)
  let existingPath = resolved
  while (!existsSync(existingPath)) {
    const parent = path.dirname(existingPath)
    if (parent === existingPath) throw new Error('Could not resolve the file path inside an approved location.')
    existingPath = parent
  }
  if (!containsPath(realRoot, realpathSync(existingPath))) {
    throw new Error('File path resolves outside its approved location through a symbolic link.')
  }
  return resolved
}

export function resolveTemporaryFolderAccess(settings: AssistantSettings, requestedPath: string, temporaryRoots: string[] = []) {
  const requested = requestedPath.trim()
  if (!requested) throw new Error('A folder path is required for an access request.')
  const resolved = resolveRequestedDirectoryPath(settings, requested)
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`Access requests must target an existing folder: ${resolved}`)
  if (path.resolve(resolved) === path.resolve(path.parse(resolved).root)) {
    throw new Error('Access requests cannot grant an entire drive or filesystem root.')
  }
  const realPath = realpathSync(resolved)
  if (path.resolve(realPath) === path.resolve(path.parse(realPath).root)) {
    throw new Error('Access requests cannot grant an entire drive or filesystem root.')
  }
  try {
    resolveAllowedDirectory(settings, realPath, temporaryRoots)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('Folder must be the workspace or an approved file location')) throw error
    return realPath
  }
  throw new Error('This folder is already accessible; no additional access request is needed.')
}

export function temporaryAccessRootForPath(requestedPath: string, temporaryRoots: string[]) {
  const target = path.resolve(requestedPath)
  return temporaryRoots
    .filter((root) => containsPath(path.resolve(root), target))
    .sort((left, right) => path.resolve(right).length - path.resolve(left).length)[0]
}

export function isAccessibleFilePath(settings: AssistantSettings, requestedPath: string, temporaryRoots: string[] = []) {
  try {
    resolveAllowedFilePath(settings, requestedPath, temporaryRoots)
    return true
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('File path must be inside your workspace')) return false
    throw error
  }
}

function resolveAllowedDirectory(settings: AssistantSettings, requestedPath: string, temporaryRoots: string[] = []) {
  const requested = requestedPath.trim()
  const resolved = resolveRequestedDirectoryPath(settings, requested)
  let requestedRootLabel = ''
  const matchingAlias = settings.allowedFolders.map((entry) => {
    const separator = entry.indexOf('=')
    return separator > 0 ? { alias: entry.slice(0, separator).trim(), target: entry.slice(separator + 1).trim() } : undefined
  }).find((location) => location?.alias && (
    location.alias.toLowerCase() === requested.toLowerCase()
    || (requested.length > location.alias.length
      && requested.slice(0, location.alias.length).toLowerCase() === location.alias.toLowerCase()
      && ['\\', '/'].includes(requested[location.alias.length]))
  ))
  if (matchingAlias) {
    requestedRootLabel = matchingAlias.alias
  }

  const roots = allowedRoots(settings, temporaryRoots).flatMap((root) => {
    const locations = [{ root, base: root.path }]
    if (existsSync(root.path) && statSync(root.path).isDirectory()) {
      const realRoot = realpathSync(root.path)
      if (realRoot.toLowerCase() !== root.path.toLowerCase()) locations.push({ root, base: realRoot })
    }
    return locations.filter(({ base }) => containsPath(base, resolved))
  }).sort((left, right) => right.base.length - left.base.length)
  const allowed = roots.find(({ root, base }) => {
    const relative = path.relative(base, resolved)
    return (relative === '' || root.recursive)
      && (!requestedRootLabel || root.label.toLowerCase() === requestedRootLabel.toLowerCase())
  })
  if (!allowed) throw new Error('Folder must be the workspace or an approved file location with the required subfolder access.')
  if (!existsSync(allowed.root.path) || !statSync(allowed.root.path).isDirectory()) {
    throw new Error(`Approved file location is not available: ${allowed.root.path}`)
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`Folder does not exist: ${resolved}`)
  const realRoot = realpathSync(allowed.root.path)
  const realDirectory = realpathSync(resolved)
  if (!containsPath(realRoot, realDirectory)) throw new Error('Folder resolves outside its approved location through a symbolic link.')
  return { path: realDirectory, root: allowed.root }
}

export function browseAccessibleFiles(settings: AssistantSettings, requestedPath: string, offset: number, temporaryRoots: string[] = []) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('File listing offset must be a non-negative whole number.')
  const directory = resolveAllowedDirectory(settings, requestedPath, temporaryRoots)
  const entries = readdirSync(directory.path, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink()
      && !['.git', 'node_modules'].includes(entry.name.toLowerCase())
      && !(entry.isFile() && /^\.env(?:\.|$)/i.test(entry.name)))
    .flatMap((entry) => {
      const target = path.join(directory.path, entry.name)
      if (entry.isDirectory()) {
        return [{
          name: entry.name,
          type: 'folder' as const,
          path: target,
          accessible: directory.root.recursive
        }]
      }
      if (!entry.isFile()) return []
      const realPath = realpathSync(target)
      return containsPath(realpathSync(directory.root.path), realPath)
        ? [{ name: entry.name, type: 'file' as const, path: realPath, accessible: true }]
        : []
    })
    .sort((left, right) => Number(right.type === 'folder') - Number(left.type === 'folder')
      || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
  const pageSize = 25
  const page = entries.slice(offset, offset + pageSize)
  const nextOffset = offset + page.length < entries.length ? offset + page.length : undefined
  return {
    directory: directory.path,
    entries: page,
    total: entries.length,
    nextOffset,
    hasMore: nextOffset !== undefined
  }
}

export function searchAccessibleFiles(settings: AssistantSettings, query: string, temporaryRoots: string[] = [], requestedPath?: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length < 2 || normalizedQuery.length > 100) {
    throw new Error('File name search must be between 2 and 100 characters.')
  }
  const matches: Array<{ name: string; path: string; score: number }> = []
  const errors: string[] = []
  const seenFiles = new Set<string>()
  let scannedEntries = 0
  let truncated = false
  const maxScannedEntries = 10_000
  const maxCollectedMatches = 100
  const searchRoots = requestedPath === undefined
    ? allowedRoots(settings, temporaryRoots)
    : (() => {
      const directory = resolveAllowedDirectory(settings, requestedPath, temporaryRoots)
      return [{ ...directory.root, path: directory.path }]
    })()
  for (const root of searchRoots) {
    if (!existsSync(root.path) || !statSync(root.path).isDirectory()) {
      errors.push(`${root.label}: location is unavailable (${root.path})`)
      continue
    }
    const realRoot = realpathSync(root.path)
    const directories = [realRoot]
    while (directories.length && scannedEntries < maxScannedEntries && matches.length < maxCollectedMatches) {
      const directory = directories.pop()!
      let entries
      try {
        entries = readdirSync(directory, { withFileTypes: true })
      } catch (error) {
        errors.push(`${directory}: ${error instanceof Error ? error.message : 'could not list folder'}`)
        continue
      }
      for (const entry of entries) {
        if (scannedEntries >= maxScannedEntries || matches.length >= maxCollectedMatches) {
          truncated = true
          break
        }
        scannedEntries += 1
        if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name.toLowerCase())) continue
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (root.recursive) directories.push(target)
          continue
        }
        if (!entry.isFile() || /^\.env(?:\.|$)/i.test(entry.name)) continue
        const realPath = realpathSync(target)
        const key = realPath.toLowerCase()
        if (!containsPath(realRoot, realPath) || seenFiles.has(key)) continue
        seenFiles.add(key)
        const fileName = entry.name.toLowerCase()
        const index = fileName.indexOf(normalizedQuery)
        if (index >= 0) matches.push({
          name: entry.name,
          path: realPath,
          score: (index === 0 ? 0 : 100) + fileName.length
        })
      }
      if (directories.length && (scannedEntries >= maxScannedEntries || matches.length >= maxCollectedMatches)) truncated = true
      if (scannedEntries >= maxScannedEntries || matches.length >= maxCollectedMatches) break
    }
    if (scannedEntries >= maxScannedEntries || matches.length >= maxCollectedMatches) {
      truncated = true
      break
    }
  }
  matches.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
  return {
    matches: matches.slice(0, 20).map(({ name, path: filePath }) => ({ name, path: filePath })),
    scannedEntries,
    truncated,
    errors
  }
}

export function readAccessibleFile(settings: AssistantSettings, requestedPath: string, temporaryRoots: string[] = []) {
  const target = resolveAllowedFilePath(settings, requestedPath, temporaryRoots)
  if (!existsSync(target)) throw new Error('That file does not exist.')
  const data = readFileSync(target)
  if (data.length > 128 * 1024) throw new Error('File is larger than the 128 KB read limit.')
  if (data.includes(0)) throw new Error('Binary files cannot be read as text.')
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(data)
    return { path: target, content }
  } catch {
    throw new Error('File is not valid UTF-8 text.')
  }
}
