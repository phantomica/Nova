import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'

const projectRoot = resolve(process.cwd())
const canonicalProjectRoot = realpathSync.native(projectRoot)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(projectRoot, 'electron/main.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(projectRoot, 'electron/preload.ts') } } }
  },
  renderer: {
    root: projectRoot,
    plugins: [react()],
    server: { fs: { allow: [projectRoot, canonicalProjectRoot] } },
    build: { rollupOptions: { input: 'index.html' } }
  }
})
