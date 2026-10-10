import { execFile } from 'node:child_process'
import os from 'node:os'
import { isSystemDiagnosticEnabled } from '../../src/shared'
import type { FeatureToolHandler } from './tool-types'

type PerformanceSnapshot = {
  cpuPercent: number
  availableMemoryBytes: number
  totalMemoryBytes: number
  logicalProcessors: number
}

type ProcessSnapshot = {
  topCpu: Array<{ name: string; processId: number; cpuPercent: number; memoryBytes: number }>
  topMemory: Array<{ name: string; processId: number; cpuPercent: number; memoryBytes: number }>
}

type DiskSnapshot = {
  volumes: Array<{ drive: string; sizeBytes: number; freeBytes: number }>
  devices: Array<{ name: string; busyPercent: number; readBytesPerSecond: number; writeBytesPerSecond: number }>
}

type NetworkSnapshot = {
  adapters: Array<{ name: string; receivedBytesPerSecond: number; sentBytesPerSecond: number }>
}

function requireDiagnostics(enabled: boolean, category: string) {
  if (!enabled) throw new Error(`${category} diagnostics are disabled in Settings.`)
  if (process.platform !== 'win32') throw new Error('System diagnostics are currently supported on Windows only.')
}

function queryWindows<T>(script: string, environment?: NodeJS.ProcessEnv): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 15_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      env: environment ? { ...process.env, ...environment } : process.env
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`Windows diagnostics query failed: ${error.message}`))
        return
      }
      try {
        const value: unknown = JSON.parse(stdout)
        if (!value || typeof value !== 'object') throw new Error('The diagnostics query returned an unexpected response.')
        resolve(value as T)
      } catch (parseError) {
        reject(new Error(`Could not parse Windows diagnostics response: ${parseError instanceof Error ? parseError.message : String(parseError)}`))
      }
    })
  })
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Windows diagnostics returned an invalid byte count.')
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let amount = bytes
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatRate(bytesPerSecond: number) {
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatProcesses(processes: ProcessSnapshot['topCpu']) {
  if (!processes.length) return '  (none reported)'
  return processes.map((item) =>
    `  ${item.name} (PID ${item.processId}): ${item.cpuPercent.toFixed(1)}% CPU, ${formatBytes(item.memoryBytes)} working set`
  ).join('\n')
}

const getSystemTime: FeatureToolHandler = (args) => {
  const timeZones = args.timeZones
  if (timeZones !== undefined && (!Array.isArray(timeZones) || timeZones.length > 10
    || timeZones.some((timeZone) => typeof timeZone !== 'string' || !timeZone.trim() || timeZone.length > 100))) {
    throw new Error('timeZones must be an array of up to 10 valid IANA timezone names.')
  }

  const now = new Date()
  const requestedTimeZones: string[] = []
  if (Array.isArray(timeZones)) {
    for (const timeZone of timeZones) {
      if (typeof timeZone !== 'string') throw new Error('timeZones must contain only IANA timezone names.')
      const normalizedTimeZone = timeZone.trim()
      if (!normalizedTimeZone || normalizedTimeZone.length > 100) {
        throw new Error('timeZones must contain only non-empty IANA timezone names of 100 characters or fewer.')
      }
      if (!requestedTimeZones.includes(normalizedTimeZone)) requestedTimeZones.push(normalizedTimeZone)
    }
  }
  const formatTime = (timeZone: string) => {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone,
      dateStyle: 'full',
      timeStyle: 'long'
    })
    return `${formatter.resolvedOptions().timeZone}: ${formatter.format(now)}`
  }
  const systemTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const locale = Intl.DateTimeFormat().resolvedOptions().locale
  const uptimeSeconds = Math.floor(os.uptime())
  const uptimeDays = Math.floor(uptimeSeconds / 86_400)
  const uptimeHours = Math.floor((uptimeSeconds % 86_400) / 3_600)
  const uptimeMinutes = Math.floor((uptimeSeconds % 3_600) / 60)
  const gibibytes = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(1)} GiB`

  let result = [
    `Current instant: ${now.toISOString()}`,
    `System local time: ${formatTime(systemTimeZone)}`,
    `Operating system: ${os.type()} ${os.release()} (${os.arch()})`,
    `Locale: ${locale}`,
    `System uptime: ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m`,
    `Memory: ${gibibytes(os.freemem())} available of ${gibibytes(os.totalmem())} total`
  ].join('\n')
  for (const timeZone of requestedTimeZones) {
    try {
      result += `\n${formatTime(timeZone)}`
    } catch (error) {
      if (error instanceof RangeError) throw new Error(`Invalid IANA timezone: ${timeZone}`)
      throw error
    }
  }
  return { result }
}

const getSystemPerformance: FeatureToolHandler = async (_args, context) => {
  requireDiagnostics(isSystemDiagnosticEnabled(context.settings, 'performance'), 'Performance')
  const snapshot = await queryWindows<PerformanceSnapshot>(`
$ErrorActionPreference = 'Stop'
$processor = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'"
$memory = Get-CimInstance Win32_OperatingSystem
if ($null -eq $processor -or $null -eq $memory) { throw 'Windows performance counters are unavailable.' }
[pscustomobject]@{
  cpuPercent = [double]$processor.PercentProcessorTime
  availableMemoryBytes = [double]$memory.FreePhysicalMemory * 1KB
  totalMemoryBytes = [double]$memory.TotalVisibleMemorySize * 1KB
  logicalProcessors = [Environment]::ProcessorCount
} | ConvertTo-Json -Compress
`)
  if (![Number.isFinite(snapshot.cpuPercent) || !Number.isFinite(snapshot.availableMemoryBytes)
    || !Number.isFinite(snapshot.totalMemoryBytes) || snapshot.totalMemoryBytes <= 0]) {
    throw new Error('Windows diagnostics returned invalid CPU or memory measurements.')
  }
  const usedMemory = snapshot.totalMemoryBytes - snapshot.availableMemoryBytes
  return {
    result: [
      `CPU utilization: ${snapshot.cpuPercent.toFixed(1)}%`,
      `Memory in use: ${formatBytes(usedMemory)} of ${formatBytes(snapshot.totalMemoryBytes)} (${(usedMemory / snapshot.totalMemoryBytes * 100).toFixed(1)}%); ${formatBytes(snapshot.availableMemoryBytes)} available`,
      `Logical processors: ${snapshot.logicalProcessors}`,
      'These are point-in-time readings; repeat the check to confirm sustained load.'
    ].join('\n')
  }
}

const listResourceProcesses: FeatureToolHandler = async (_args, context) => {
  requireDiagnostics(isSystemDiagnosticEnabled(context.settings, 'processes'), 'Process')
  const snapshot = await queryWindows<ProcessSnapshot>(`
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $_.IDProcess -gt 0 -and $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } |
  ForEach-Object {
    [pscustomobject]@{
      name = [string]$_.Name
      processId = [int]$_.IDProcess
      cpuPercent = [math]::Round(([double]$_.PercentProcessorTime / [Environment]::ProcessorCount), 1)
      memoryBytes = [long]$_.WorkingSetPrivate
    }
  })
[pscustomobject]@{
  topCpu = @($processes | Sort-Object cpuPercent -Descending | Select-Object -First 10)
  topMemory = @($processes | Sort-Object memoryBytes -Descending | Select-Object -First 10)
} | ConvertTo-Json -Depth 4 -Compress
`)
  return {
    result: [
      'Top processes by current CPU use:',
      formatProcesses(snapshot.topCpu),
      '',
      'Top processes by private working-set memory:',
      formatProcesses(snapshot.topMemory),
      'Process names and resource usage are shown; command lines and user data are not collected.'
    ].join('\n')
  }
}

const findProcess: FeatureToolHandler = async (args, context) => {
  requireDiagnostics(isSystemDiagnosticEnabled(context.settings, 'processes'), 'Process')
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (!name || name.length > 260 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('A process name or executable name of 1 to 260 characters is required.')
  }
  const matches = await queryWindows<Array<{ name: string; processId: number; memoryBytes: number }>>(`
$ErrorActionPreference = 'Stop'
$query = [System.IO.Path]::GetFileNameWithoutExtension($env:NOVA_PROCESS_QUERY)
$matches = @(Get-Process |
  Where-Object { $_.ProcessName -ieq $query } |
  Select-Object -First 20 |
  ForEach-Object {
    [pscustomobject]@{ name = [string]$_.ProcessName; processId = [int]$_.Id; memoryBytes = [long]$_.WorkingSet64 }
  })
ConvertTo-Json -InputObject @($matches) -Compress
`, { NOVA_PROCESS_QUERY: name })
  if (!matches.length) return { result: `No running process matched "${name}".` }
  return {
    result: [
      `Found ${matches.length === 20 ? 'at least ' : ''}${matches.length} running process${matches.length === 1 ? '' : 'es'} matching "${name}":`,
      ...matches.map((item) => `  ${item.name} (PID ${item.processId}): ${formatBytes(item.memoryBytes)} working set`)
    ].join('\n')
  }
}

const getDiskStatus: FeatureToolHandler = async (_args, context) => {
  requireDiagnostics(isSystemDiagnosticEnabled(context.settings, 'disks'), 'Disk')
  const snapshot = await queryWindows<DiskSnapshot>(`
$ErrorActionPreference = 'Stop'
$volumes = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
  ForEach-Object {
    [pscustomobject]@{ drive = [string]$_.DeviceID; sizeBytes = [long]$_.Size; freeBytes = [long]$_.FreeSpace }
  })
$devices = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk |
  Where-Object { $_.Name -ne '_Total' } |
  ForEach-Object {
    [pscustomobject]@{
      name = [string]$_.Name
      busyPercent = [double]$_.PercentDiskTime
      readBytesPerSecond = [double]$_.DiskReadBytesPersec
      writeBytesPerSecond = [double]$_.DiskWriteBytesPersec
    }
  })
[pscustomobject]@{ volumes = $volumes; devices = $devices } | ConvertTo-Json -Depth 4 -Compress
`)
  const volumes = snapshot.volumes.map((volume) => {
    if (volume.sizeBytes <= 0 || volume.freeBytes < 0) throw new Error('Windows diagnostics returned an invalid disk capacity.')
    const usedPercent = ((volume.sizeBytes - volume.freeBytes) / volume.sizeBytes * 100).toFixed(1)
    return `  ${volume.drive}: ${formatBytes(volume.freeBytes)} free of ${formatBytes(volume.sizeBytes)} (${usedPercent}% used)`
  })
  const devices = snapshot.devices.map((device) => {
    if (!Number.isFinite(device.busyPercent)) throw new Error('Windows diagnostics returned an invalid disk activity measurement.')
    return `  ${device.name}: ${device.busyPercent.toFixed(1)}% busy; read ${formatRate(device.readBytesPerSecond)}, write ${formatRate(device.writeBytesPerSecond)}`
  })
  return {
    result: [
      'Drive capacity:',
      ...(volumes.length ? volumes : ['  No fixed drives reported.']),
      '',
      'Physical disk activity:',
      ...(devices.length ? devices : ['  No disk activity counters reported.']),
      'Disk activity is a snapshot; high utilization or low free space can contribute to slowdowns, but does not identify the responsible process.'
    ].join('\n')
  }
}

const getNetworkStatus: FeatureToolHandler = async (_args, context) => {
  requireDiagnostics(isSystemDiagnosticEnabled(context.settings, 'network'), 'Network')
  const snapshot = await queryWindows<NetworkSnapshot>(`
$ErrorActionPreference = 'Stop'
$adapters = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface |
  Where-Object { $_.Name -notmatch 'Loopback' } |
  ForEach-Object {
    [pscustomobject]@{
      name = [string]$_.Name
      receivedBytesPerSecond = [double]$_.BytesReceivedPersec
      sentBytesPerSecond = [double]$_.BytesSentPersec
    }
  })
[pscustomobject]@{ adapters = $adapters } | ConvertTo-Json -Depth 4 -Compress
`)
  const adapters = snapshot.adapters.map((adapter) =>
    `  ${adapter.name}: received ${formatRate(adapter.receivedBytesPerSecond)}, sent ${formatRate(adapter.sentBytesPerSecond)}`
  )
  return {
    result: [
      'Network adapter traffic:',
      ...(adapters.length ? adapters : ['  No network adapter counters reported.']),
      'Rates are system-wide per adapter snapshots, not a speed test or per-download measurement; they cannot by themselves prove an internet or service-side bottleneck.'
    ].join('\n')
  }
}

export const toolHandlers: Record<string, FeatureToolHandler> = {
  get_system_information: getSystemTime,
  get_system_performance: getSystemPerformance,
  list_resource_processes: listResourceProcesses,
  find_running_process: findProcess,
  get_disk_status: getDiskStatus,
  get_network_status: getNetworkStatus
}
