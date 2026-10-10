# Nova · Desktop AI

Nova is a Windows-first desktop assistant for a local [Ollama](https://ollama.com/) model. It stays available as a draggable floating desktop button and in the system tray, and provides a compact chat window, voice input/output, configurable agent skills, and reviewable file proposals.

This project is licensed under the [MIT License](./LICENSE).

## Run on Windows

1. Install Node.js 22.12 or newer and [Ollama](https://ollama.com/).
2. Pull a model that supports Ollama chat/tool calling, for example `ollama pull gemma4`.
3. In this folder run `npm install`, then `npm run dev`. This starts the Electron desktop window. The Vite address printed in the terminal is only the renderer development server; opening that address in a regular browser does not provide Electron's desktop bridge.
4. Use the settings button to configure the Ollama URL/model, workspace, allowed applications, and voice preferences.

Use `npm run build` to build the Electron main, preload, and renderer bundles, then `npm start` to run the built app. A Windows installer/signing pipeline is not included yet.

After changing Electron's main or preload code, quit any existing Nova windows and stop the old development server before running `npm run dev` again; Vite's renderer hot reload does not reload the preload bridge in an already-running Electron window.

## Current capabilities

- Chat through Ollama's local `/api/chat` endpoint. The model can be changed in Settings.
- Search the web through DuckDuckGo and return result titles, snippets, and links to the model for current-information questions. Nova can also open a requested HTTP/HTTPS website (for example, `youtube.com`) in the default browser. Search-result text is treated as untrusted reference data.
- Launch executables from the configurable program list; entries can be executable names available on PATH, full absolute executable paths, Spotify links, or Steam links (including game IDs). Defaults include Discord, Firefox, Obsidian, Steam, Spotify, and VS Code; use full paths when an app is not on PATH. Nova can close only processes it launched itself in the current session.
- Open selected Windows Settings pages and sub-pages, open configured File Explorer folders (optionally with friendly aliases and per-folder subfolder access), and control Windows playback and audio with ordered command batches, repeated track/volume-key actions, time-based seeking, player status, exact system volume, explicit mute/unmute, output-device selection, and per-app volume. App/Settings/Explorer access and media controls each have Settings switches.
- Configure custom REST API integrations in Settings: set a base URL, optional bearer token, and an explicit list of HTTP methods and endpoint paths. Each API operation independently controls whether confirmation is required, so trusted playback actions can run immediately while sensitive operations can prompt first. Credentials are encrypted with Windows via Electron `safeStorage` and are never included in model prompts. For example, a Spotify integration can use Spotify Web API playback endpoints with a valid bearer token and the required account scopes; OAuth token acquisition/refresh is not built in.
- Agent tool actions are recorded in the conversation with their arguments and result, including program launches, file proposals, searches, and API requests. Confirmable API calls show a review card in chat before they execute.
- List and read workspace files, then prepare create/edit/delete proposals for text files under the configured workspace. Workspace listing is capped at 200 files and skips `.env` files, dependencies, and symbolic links; individual reads are capped at 128 KB. Proposals are shown in chat with a diff preview, editable contents, and explicit confirm/deny actions. Confirmation checks that the original file has not changed since the proposal was prepared.
- Use the multilingual Whisper Small model locally for push-to-talk or an optional wake phrase, and system text-to-speech for spoken replies. Nova begins loading Whisper in the background at startup, so it is ready sooner when you first speak; the first launch downloads about 250 MB to app data. Push-to-talk automatically ends after a pause in speech, and the composer stop button interrupts a response or spoken reply. German is the default transcription language, with other languages and auto-detection available in Settings. Choose Nova's installed TTS voice and adjust its speech rate in Settings, or quickly mute/unmute speech beside the microphone. The Voice setting “Interrupt speech for voice input” stops active TTS when push-to-talk starts or Whisper recognizes the wake phrase.
- Chat and speech bubbles render common Markdown formatting (headings, emphasis, ordered/unordered lists, quotes, rules, and inline/fenced code); speech output strips Markdown syntax before speaking. Voice settings are grouped separately from bubble appearance and dismissal preferences.
- The in-app microphone test requests audio-only access. Recorded speech is resampled and transcribed locally; audio is not sent to an online speech service. Windows microphone privacy settings must permit desktop apps. Wake-word mode processes local audio segments and requires Nova to remain open; its hidden chat renderer keeps audio-segmentation timers active. Say the wake phrase and request together for the quickest response; if you say only the phrase, wait for Nova's prompt before giving the request.
- The floating Nova button can be dragged around the desktop and remembers its location by default. Chat opens beside the floating button by default; enable “Remember chat window position” in Desktop settings to restore its last location instead. Choose whether chat size resets whenever it opens, only after Nova restarts (default), or never (in which case its size is restored after a restart). Visible reply bubbles reposition around the floating button. A colored dot shows when Nova is listening, has heard the wake phrase, is recognizing speech, thinking, or speaking. Only thinking appears in an animated status bubble. Reply bubbles grow to fit longer answers where screen space allows, then scroll; Voice settings offer a fixed timeout or keeping them visible through TTS plus the selected 2–60 second delay. The button hides while chat is open so it cannot cover chat controls.
- Pending file proposals appear in the floating speech bubble with an expandable diff and Confirm/Deny actions; choose Edit in chat for the full editing workflow. Confirmed changes still verify that the original file has not changed since the proposal was created.
- Configure Nova in the navigable Settings workspace. Choose the Nova, Midnight, or Dusk app theme and customize its accent color, or reset appearance to the default. Add approved File Explorer locations with the native folder picker, edit optional aliases, and remove locations from the list. Settings are stored locally in Electron's user data directory.

## Code map

- `electron/main.ts` owns settings and credentials, Ollama and Whisper requests, desktop windows, and the privileged `tool:run` boundary. Agent implementations are auto-discovered from `electron/features/*.feature.ts`; focused platform helpers (for example app launching or Windows media keys) can live beside them.
- `electron/preload.ts` exposes the narrow, typed `window.desktop` bridge. Keep Node.js and Electron APIs out of the renderer; new privileged features should have an IPC handler and a matching bridge method.
- `src/ui/App.tsx` coordinates chat history, voice capture, Ollama requests, and action traces. The UI-only settings, approval, floating-button, and bubble components live in `src/ui/components.tsx`.
- `src/ui/agent-tools.ts` auto-discovers feature-owned schemas and settings gates from `src/ui/agent-tools/*.feature.ts`. Feature tool handlers are independently auto-discovered in `electron/features/*.feature.ts`; matching names connect schemas to implementations. API schemas are generated from the enabled integrations.
- `src/ui/formatting.tsx` contains the supported Markdown renderer, speech-text cleanup, bounded diff generation, and audio resampling helper.
- `src/shared.ts` defines the settings, messages, and bridge types shared by the main and renderer processes; `src/ui/styles.css` contains the interface styling.

### Adding an agent capability

1. Add a `*.feature.ts` schema module under `src/ui/agent-tools/`, exporting `agentToolFeature` with `tools` and an `enabled(settings)` gate.
2. Add a matching `*.feature.ts` implementation under `electron/features/`, exporting a `toolHandlers` map keyed by the schema tool names. The registry discovers these modules automatically; no edits to `App.tsx`, `main.ts`, or a central tool list are needed.
3. Treat model-supplied arguments as untrusted and enforce permissions, allowlists, and confirmation requirements inside the main-process handler. Add settings/types or a preload method only when the feature truly needs those surfaces.
4. Keep user-facing controls and safety behavior documented here, then run `npm run typecheck` and `npm run build`.

## Safety boundaries

The renderer has no direct Node.js access. File operations are constrained to the configured workspace; program launch is restricted to the allowed-app list; Explorer access is restricted to configured folder paths; Windows Settings is restricted to supported pages; web searches are sent only to DuckDuckGo, and website opening accepts only HTTP/HTTPS URLs. Custom API calls are restricted to the configured integration hosts, methods, and endpoint paths; redirects are blocked, request bodies are capped at 16 KB, and responses at 64 KB. Set operation-specific confirmation for sensitive actions; configured playback actions may run without a prompt. File confirmations are enabled by default. Disabling them in Settings permits file operations to write immediately.
