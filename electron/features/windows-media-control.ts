import { spawn } from 'node:child_process'

const mediaActions: Record<string, { key: number; label: string }> = {
  'play-pause': { key: 0xb3, label: 'toggled media playback' },
  next: { key: 0xb0, label: 'skipped to the next track' },
  previous: { key: 0xb1, label: 'returned to the previous track' },
  'volume-up': { key: 0xaf, label: 'increased system volume' },
  'volume-down': { key: 0xae, label: 'decreased system volume' },
  mute: { key: 0xad, label: 'toggled system mute' }
}

export async function controlWindowsMedia(action: string) {
  const selectedAction = mediaActions[action]
  if (!selectedAction) throw new Error('Unsupported Windows media action.')
  const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NovaMediaKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo); }'
[NovaMediaKey]::keybd_event(${selectedAction.key}, 0, 0, [UIntPtr]::Zero)
[NovaMediaKey]::keybd_event(${selectedAction.key}, 0, 2, [UIntPtr]::Zero)
`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2000) })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Windows media control timed out.'))
    }, 10_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Could not start Windows media control: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Windows media control failed${stderr.trim() ? `: ${stderr.trim()}` : ` (exit ${code})`}.`))
    })
  })
  return `Windows ${selectedAction.label}.`
}
