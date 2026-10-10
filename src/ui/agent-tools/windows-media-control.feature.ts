import type { AssistantSettings } from '../../shared'

const mediaControlTool = {
  type: 'function',
  function: {
    name: 'windows_media_control',
    description: 'Control Windows media playback and system audio. Send an ordered commands array to chain actions in one request. Use repeat for media-key actions; set-volume for exact system volume; unmute without changing volume; seek-forward or seek-backward with seconds; stop or get-status for the active player; list-output-devices before set-output-device; list-audio-apps before set-app-volume, which accepts an app executable name (for example Spotify.exe).',
    parameters: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['play-pause', 'next', 'previous', 'volume-up', 'volume-down', 'set-volume', 'mute', 'unmute', 'seek-forward', 'seek-backward', 'stop', 'get-status', 'list-output-devices', 'set-output-device', 'list-audio-apps', 'set-app-volume'] },
              repeat: { type: 'integer', minimum: 1, maximum: 20, description: 'Repeat a media-key action this many times. Omit for one.' },
              volume: { type: 'number', minimum: 0, maximum: 100, description: 'Required for set-volume or set-app-volume; the exact volume percentage.' },
              seconds: { type: 'number', minimum: 1, maximum: 3600, description: 'Required for seek-forward or seek-backward.' },
              device: { type: 'string', description: 'Required for set-output-device. Prefer a name or ID returned by list-output-devices.' },
              app: { type: 'string', description: 'Required for set-app-volume. The exact process name, such as Spotify.exe; applies to all active audio sessions for that process.' }
            },
            required: ['action']
          }
        }
      },
      required: ['commands']
    }
  }
}

export const agentToolFeature = {
  tools: [mediaControlTool],
  enabled: (settings: AssistantSettings) => settings.mediaControlEnabled
}
