const fs = require('node:fs')

try {
  const executable = require('electron')
  if (typeof executable !== 'string' || !fs.existsSync(executable)) {
    throw new Error(`Electron executable was not found at ${String(executable)}.`)
  }
} catch (error) {
  console.error('Electron is installed without its runtime binary. Try "npm install" with install scripts enabled.')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
