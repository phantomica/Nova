import type { FeatureToolContext, FeatureToolHandler } from './tool-types'

const featureModules = import.meta.glob<{ toolHandlers: Record<string, FeatureToolHandler> }>('./*.feature.ts', {
  eager: true,
  import: 'toolHandlers'
})
const handlers = Object.values(featureModules).reduce<Record<string, FeatureToolHandler>>((registered, featureHandlers) => {
  for (const [name, handler] of Object.entries(featureHandlers)) {
    if (Object.hasOwn(registered, name)) throw new Error(`Agent tool "${name}" is registered by more than one feature.`)
    registered[name] = handler
  }
  return registered
}, {})

export function runFeatureTool(name: string, args: Record<string, unknown>, context: FeatureToolContext) {
  const handler = handlers[name]
  if (!handler) throw new Error(`Unknown agent action: ${name}`)
  return handler(args, context)
}
