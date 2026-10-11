import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AssistantSettings } from '../shared'

export type SettingsGroupProps = {
  settings: AssistantSettings
  setSetting: <K extends keyof AssistantSettings>(key: K, value: AssistantSettings[K]) => void
}

export type SettingsGroup = {
  id: string
  label: string
  icon: LucideIcon
  Component: ComponentType<SettingsGroupProps>
}

export const featureSettingsGroups = Object.values(
  import.meta.glob<SettingsGroup>('./settings/*.tsx', { eager: true, import: 'default' })
)
