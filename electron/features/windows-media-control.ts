import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'

type MediaCommand = {
  action: string
  repeat?: number
  volume?: number
  seconds?: number
  device?: string
  app?: string
}

const mediaActions: Record<string, { key: number; label: string }> = {
  'play-pause': { key: 0xb3, label: 'toggled media playback' },
  next: { key: 0xb0, label: 'skipped to the next track' },
  previous: { key: 0xb1, label: 'returned to the previous track' },
  'volume-up': { key: 0xaf, label: 'increased system volume' },
  'volume-down': { key: 0xae, label: 'decreased system volume' }
}

const actionsWithoutRepeat = [
  'set-volume', 'mute', 'unmute', 'seek-forward', 'seek-backward', 'stop',
  'get-status', 'list-output-devices', 'set-output-device', 'list-audio-apps', 'set-app-volume'
]

const audioControlType = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class NovaMMDeviceEnumerator {}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out NovaIMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out NovaIMMDevice endpoint);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out NovaIMMDevice device);
}

[ComImport]
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index, out NovaIMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out object activatedInterface);
  [PreserveSig] int OpenPropertyStore(uint access, out NovaIPropertyStore propertyStore);
  [PreserveSig] int GetId(out IntPtr id);
  [PreserveSig] int GetState(out uint state);
}

[StructLayout(LayoutKind.Sequential)]
public struct NovaPropertyKey {
  public Guid formatId;
  public int propertyId;
}

[StructLayout(LayoutKind.Explicit)]
public struct NovaPropVariant {
  [FieldOffset(0)] public ushort type;
  [FieldOffset(8)] public IntPtr stringValue;
}

[ComImport]
[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out NovaPropertyKey key);
  [PreserveSig] int GetValue(ref NovaPropertyKey key, out NovaPropVariant value);
  [PreserveSig] int SetValue(ref NovaPropertyKey key, ref NovaPropVariant value);
  [PreserveSig] int Commit();
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int GetChannelCount(out uint channelCount);
  [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid eventContext);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
  [PreserveSig] int GetMasterVolumeLevel(out float level);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid eventContext);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
  [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[ComImport]
[Guid("F8679F50-850A-41CF-9C72-430F290290C8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, out long defaultPeriod, out long minimumPeriod);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref NovaPropertyKey key, out NovaPropVariant value);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref NovaPropertyKey key, ref NovaPropVariant value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
}

[ComImport]
[Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
public class NovaPolicyConfigClient {}

[ComImport]
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIAudioSessionManager2 {
  [PreserveSig] int GetAudioSessionControl(ref Guid sessionId, uint flags, out IntPtr sessionControl);
  [PreserveSig] int GetSimpleAudioVolume(ref Guid sessionId, uint flags, out IntPtr audioVolume);
  [PreserveSig] int GetSessionEnumerator(out NovaIAudioSessionEnumerator sessionEnumerator);
  [PreserveSig] int RegisterSessionNotification(IntPtr notification);
  [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
  [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
  [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
}

[ComImport]
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIAudioSessionEnumerator {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int GetSession(int index, out NovaIAudioSessionControl session);
}

[ComImport]
[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIAudioSessionControl {
  [PreserveSig] int GetState(out int state);
  [PreserveSig] int GetDisplayName(out IntPtr displayName);
  [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, ref Guid eventContext);
  [PreserveSig] int GetIconPath(out IntPtr iconPath);
  [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, ref Guid eventContext);
  [PreserveSig] int GetGroupingParam(out Guid groupingId);
  [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
  [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
  [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
}

[ComImport]
[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaIAudioSessionControl2 {
  [PreserveSig] int GetState(out int state);
  [PreserveSig] int GetDisplayName(out IntPtr displayName);
  [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, ref Guid eventContext);
  [PreserveSig] int GetIconPath(out IntPtr iconPath);
  [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, ref Guid eventContext);
  [PreserveSig] int GetGroupingParam(out Guid groupingId);
  [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid eventContext);
  [PreserveSig] int RegisterAudioSessionNotification(IntPtr notification);
  [PreserveSig] int UnregisterAudioSessionNotification(IntPtr notification);
  [PreserveSig] int GetSessionIdentifier(out IntPtr sessionIdentifier);
  [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr sessionInstanceIdentifier);
  [PreserveSig] int GetProcessId(out uint processId);
  [PreserveSig] int IsSystemSoundsSession();
  [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
}

[ComImport]
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface NovaISimpleAudioVolume {
  [PreserveSig] int SetMasterVolume(float volume, ref Guid eventContext);
  [PreserveSig] int GetMasterVolume(out float volume);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public static class NovaWindowsAudio {
  private static NovaIAudioEndpointVolume GetEndpointVolume() {
    var enumerator = (NovaIMMDeviceEnumerator)new NovaMMDeviceEnumerator();
    NovaIMMDevice device;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 0, out device));
    var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    object activated;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out activated));
    return (NovaIAudioEndpointVolume)activated;
  }

  public static void SetVolume(float volume) {
    var endpoint = GetEndpointVolume();
    var context = Guid.Empty;
    Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(volume, ref context));
  }

  public static void SetMute(bool mute) {
    var endpoint = GetEndpointVolume();
    var context = Guid.Empty;
    Marshal.ThrowExceptionForHR(endpoint.SetMute(mute, ref context));
  }

  private static List<Tuple<string, string>> GetOutputDevices() {
    var devices = new List<Tuple<string, string>>();
    var enumerator = (NovaIMMDeviceEnumerator)new NovaMMDeviceEnumerator();
    NovaIMMDeviceCollection collection;
    Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out collection));
    uint count;
    Marshal.ThrowExceptionForHR(collection.GetCount(out count));
    for (uint index = 0; index < count; index++) {
      NovaIMMDevice device;
      Marshal.ThrowExceptionForHR(collection.Item(index, out device));
      IntPtr idPointer;
      Marshal.ThrowExceptionForHR(device.GetId(out idPointer));
      var id = Marshal.PtrToStringUni(idPointer);
      Marshal.FreeCoTaskMem(idPointer);
      NovaIPropertyStore properties;
      Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out properties));
      var key = new NovaPropertyKey { formatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), propertyId = 14 };
      NovaPropVariant value;
      Marshal.ThrowExceptionForHR(properties.GetValue(ref key, out value));
      var name = value.type == 31 ? Marshal.PtrToStringUni(value.stringValue) : null;
      PropVariantClear(ref value);
      if (!String.IsNullOrEmpty(id) && !String.IsNullOrEmpty(name)) devices.Add(Tuple.Create(name, id));
    }
    return devices;
  }

  public static string[] ListOutputDevices() {
    var devices = GetOutputDevices();
    var result = new string[devices.Count];
    for (var index = 0; index < devices.Count; index++) result[index] = devices[index].Item1 + " [" + devices[index].Item2 + "]";
    return result;
  }

  public static string SetDefaultOutputDevice(string selector) {
    var devices = GetOutputDevices();
    var matches = new List<Tuple<string, string>>();
    foreach (var device in devices) {
      if (String.Equals(device.Item1, selector, StringComparison.OrdinalIgnoreCase) ||
          String.Equals(device.Item2, selector, StringComparison.OrdinalIgnoreCase) ||
          String.Equals(device.Item1 + " [" + device.Item2 + "]", selector, StringComparison.OrdinalIgnoreCase) ||
          device.Item1.IndexOf(selector, StringComparison.OrdinalIgnoreCase) >= 0 ||
          device.Item2.IndexOf(selector, StringComparison.OrdinalIgnoreCase) >= 0) matches.Add(device);
    }
    if (matches.Count == 0) throw new InvalidOperationException("No active output device matches '" + selector + "'.");
    if (matches.Count > 1) throw new InvalidOperationException("The output device selector is ambiguous: " + String.Join(", ", matches.ConvertAll(device => device.Item1).ToArray()));
    var policy = (NovaIPolicyConfig)new NovaPolicyConfigClient();
    for (var role = 0; role < 3; role++) Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(matches[0].Item2, role));
    return matches[0].Item1;
  }

  private static string GetProcessName(uint processId) {
    try {
      using (var process = Process.GetProcessById((int)processId)) return process.ProcessName;
    } catch (ArgumentException) {
      return String.Empty;
    }
  }

  private static List<Tuple<string, NovaISimpleAudioVolume>> GetActiveAudioSessions() {
    var result = new List<Tuple<string, NovaISimpleAudioVolume>>();
    var enumerator = (NovaIMMDeviceEnumerator)new NovaMMDeviceEnumerator();
    NovaIMMDeviceCollection devices;
    Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out devices));
    uint deviceCount;
    Marshal.ThrowExceptionForHR(devices.GetCount(out deviceCount));
    for (uint deviceIndex = 0; deviceIndex < deviceCount; deviceIndex++) {
      NovaIMMDevice device;
      Marshal.ThrowExceptionForHR(devices.Item(deviceIndex, out device));
      var iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
      object activated;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out activated));
      var manager = (NovaIAudioSessionManager2)activated;
      NovaIAudioSessionEnumerator sessions;
      Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessions));
      int sessionCount;
      Marshal.ThrowExceptionForHR(sessions.GetCount(out sessionCount));
      for (var sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
        NovaIAudioSessionControl baseSession;
        Marshal.ThrowExceptionForHR(sessions.GetSession(sessionIndex, out baseSession));
        var session = (NovaIAudioSessionControl2)baseSession;
        uint processId;
        Marshal.ThrowExceptionForHR(session.GetProcessId(out processId));
        if (processId == 0) continue;
        var processName = GetProcessName(processId);
        if (!String.IsNullOrEmpty(processName)) {
          result.Add(Tuple.Create(processName, (NovaISimpleAudioVolume)session));
        }
      }
    }
    return result;
  }

  public static string[] ListAudioApps() {
    var names = new List<string>();
    foreach (var session in GetActiveAudioSessions()) {
      if (!names.Exists(name => String.Equals(name, session.Item1, StringComparison.OrdinalIgnoreCase))) names.Add(session.Item1);
    }
    names.Sort(StringComparer.OrdinalIgnoreCase);
    return names.ToArray();
  }

  public static int SetApplicationVolume(string app, float volume) {
    var target = app.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? app.Substring(0, app.Length - 4) : app;
    var sessions = GetActiveAudioSessions();
    var updated = 0;
    foreach (var session in sessions) {
      if (String.Equals(session.Item1, target, StringComparison.OrdinalIgnoreCase)) {
        var context = Guid.Empty;
        Marshal.ThrowExceptionForHR(session.Item2.SetMasterVolume(volume, ref context));
        updated++;
      }
    }
    if (updated == 0) throw new InvalidOperationException("No active audio session was found for '" + app + "'.");
    return updated;
  }

  [DllImport("ole32.dll")]
  private static extern int PropVariantClear(ref NovaPropVariant value);
}
`

const mediaSessionHelpers = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
function Wait-NovaWinRtOperation {
  param([object]$Operation, [type]$ResultType)
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.GetGenericTypeDefinition().FullName -eq 'Windows.Foundation.IAsyncOperation\`1' } |
    Select-Object -First 1
  if (-not $method) { throw 'Could not initialize the Windows media-session API.' }
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, [object[]]@($Operation))
  return $task.GetAwaiter().GetResult()
}
function Get-NovaMediaSession {
  $managerType = [type]::GetType('Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime')
  $operation = $managerType.GetMethod('RequestAsync').Invoke($null, @())
  $manager = Wait-NovaWinRtOperation $operation $managerType
  $session = $manager.GetCurrentSession()
  if (-not $session) { throw 'There is no active Windows media session.' }
  return $session
}
function Get-NovaMediaStatus($session) {
  $propertiesType = [type]::GetType('Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime')
  $properties = Wait-NovaWinRtOperation $session.TryGetMediaPropertiesAsync() $propertiesType
  $timeline = $session.GetTimelineProperties()
  $playback = $session.GetPlaybackInfo()
  return [pscustomobject]@{
    source = $session.SourceAppUserModelId
    status = $playback.PlaybackStatus.ToString()
    title = $properties.Title
    artist = $properties.Artist
    album = $properties.AlbumTitle
    positionSeconds = [math]::Max(0, $timeline.Position.TotalSeconds)
    durationSeconds = [math]::Max(0, ($timeline.EndTime - $timeline.StartTime).TotalSeconds)
  }
}
`

const knownActions = [...Object.keys(mediaActions), ...actionsWithoutRepeat]

function quotePowerShellString(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function validateCommand(value: unknown): MediaCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Each Windows media command must be an object.')
  }
  const command = value as Record<string, unknown>
  if (typeof command.action !== 'string' || !knownActions.includes(command.action)) {
    throw new Error(`Unsupported Windows media action: ${String(command.action ?? '')}.`)
  }
  const repeat = command.repeat ?? 1
  if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
    throw new Error('Media command repeat must be an integer from 1 to 20.')
  }
  if (actionsWithoutRepeat.includes(command.action) && repeat !== 1) {
    throw new Error(`${command.action} cannot be repeated.`)
  }
  const result: MediaCommand = { action: command.action }
  if (command.action === 'set-volume' || command.action === 'set-app-volume') {
    if (typeof command.volume !== 'number' || !Number.isFinite(command.volume) || command.volume < 0 || command.volume > 100) {
      throw new Error(`${command.action} requires a volume from 0 to 100.`)
    }
    result.volume = command.volume
  } else if (command.volume !== undefined) {
    throw new Error('Volume is only valid with set-volume or set-app-volume.')
  }
  if (command.action === 'seek-forward' || command.action === 'seek-backward') {
    if (typeof command.seconds !== 'number' || !Number.isFinite(command.seconds) || command.seconds < 1 || command.seconds > 3600) {
      throw new Error(`${command.action} requires a seek duration from 1 to 3600 seconds.`)
    }
    result.seconds = command.seconds
  } else if (command.seconds !== undefined) {
    throw new Error('Seconds are only valid with seek-forward or seek-backward.')
  }
  if (command.action === 'set-output-device' || command.action === 'set-app-volume') {
    const field = command.action === 'set-output-device' ? 'device' : 'app'
    const value = command[field]
    if (typeof value !== 'string' || !value.trim() || value.length > 200) {
      throw new Error(`${command.action} requires a non-empty ${field} name of at most 200 characters.`)
    }
    result[field] = value.trim()
  } else if (command.device !== undefined || command.app !== undefined) {
    throw new Error('Device is only valid with set-output-device and app is only valid with set-app-volume.')
  }
  return { ...result, ...(mediaActions[command.action] ? { repeat } : {}) }
}

function mediaStatusSummary(status: Record<string, unknown>) {
  const track = [status.title, status.artist].filter((part) => typeof part === 'string' && part.length > 0).join(' by ')
  const position = Number(status.positionSeconds)
  const duration = Number(status.durationSeconds)
  const timing = duration > 0
    ? ` (${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')} / ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')})`
    : ''
  return `${String(status.status ?? 'Unknown')}${track ? `: ${track}` : ''}${timing}${status.source ? ` [${String(status.source)}]` : ''}`
}

export async function controlWindowsMedia(args: Record<string, unknown>) {
  const commands = Array.isArray(args.commands)
    ? args.commands.map(validateCommand)
    : typeof args.action === 'string'
      ? [validateCommand({ action: args.action })]
      : []

  if (commands.length < 1 || commands.length > 20) {
    throw new Error('Provide between 1 and 20 Windows media commands.')
  }
  const totalRepeats = commands.reduce((total, command) => total + (command.repeat ?? 1), 0)
  if (totalRepeats > 100) throw new Error('A media command batch cannot contain more than 100 repeated actions.')

  const needsAudioControl = commands.some(({ action }) => [
    'set-volume', 'mute', 'unmute', 'list-output-devices', 'set-output-device', 'list-audio-apps', 'set-app-volume'
  ].includes(action))
  const needsMediaSession = commands.some(({ action }) => [
    'seek-forward', 'seek-backward', 'stop', 'get-status'
  ].includes(action))
  const setupLines = [
    ...(needsAudioControl ? [`$global:NovaAudioType = Add-Type -TypeDefinition @'\n${audioControlType}\n'@ -PassThru | Where-Object { $_.Name -eq 'NovaWindowsAudio' } | Select-Object -First 1`] : []),
    ...(needsMediaSession ? [mediaSessionHelpers] : [])
  ]
  const commandLines: string[] = []
  const summaries: string[] = []

  for (const command of commands) {
    if (command.action === 'set-volume') {
      const volume = command.volume as number
      commandLines.push(`$global:NovaAudioType.GetMethod('SetVolume').Invoke($null, [object[]]@([single]${(volume / 100).toString()}))`)
      summaries.push(`set system volume to ${volume}%`)
    } else if (command.action === 'mute' || command.action === 'unmute') {
      const muted = command.action === 'mute'
      commandLines.push(`$global:NovaAudioType.GetMethod('SetMute').Invoke($null, [object[]]@([bool]${muted ? '$true' : '$false'}))`)
      summaries.push(`${muted ? 'muted' : 'unmuted'} system audio`)
    } else if (mediaActions[command.action]) {
      const mediaAction = mediaActions[command.action]
      const repeat = command.repeat ?? 1
      for (let index = 0; index < repeat; index += 1) {
        commandLines.push(`$global:NovaMediaKeyType.GetMethod('keybd_event').Invoke($null, [object[]]@([byte]${mediaAction.key}, [byte]0, [uint32]0, [UIntPtr]::Zero))`)
        commandLines.push(`$global:NovaMediaKeyType.GetMethod('keybd_event').Invoke($null, [object[]]@([byte]${mediaAction.key}, [byte]0, [uint32]2, [UIntPtr]::Zero))`)
      }
      summaries.push(`${mediaAction.label}${repeat > 1 ? ` (${repeat} times)` : ''}`)
    } else if (command.action === 'get-status') {
      commandLines.push('$session = Get-NovaMediaSession')
      commandLines.push("Write-NovaResult 'get-status' (Get-NovaMediaStatus $session)")
    } else if (command.action === 'seek-forward' || command.action === 'seek-backward') {
      const delta = Math.round((command.seconds as number) * 10_000_000)
      const operation = command.action === 'seek-forward' ? '+' : '-'
      commandLines.push('$session = Get-NovaMediaSession')
      commandLines.push('$timeline = $session.GetTimelineProperties()')
      commandLines.push(`$target = [long]($timeline.Position.Ticks ${operation} ${delta})`)
      commandLines.push('$target = [math]::Max($timeline.StartTime.Ticks, $target)')
      commandLines.push('if ($timeline.EndTime.Ticks -gt $timeline.StartTime.Ticks) { $target = [math]::Min($timeline.EndTime.Ticks, $target) }')
      commandLines.push('$changed = Wait-NovaWinRtOperation $session.TryChangePlaybackPositionAsync($target) ([bool])')
      commandLines.push("if (-not $changed) { throw 'The active media player did not accept the seek request.' }")
      commandLines.push(`Write-NovaResult '${command.action}' ([pscustomobject]@{ positionSeconds = $target / 10000000.0 })`)
    } else if (command.action === 'stop') {
      commandLines.push('$session = Get-NovaMediaSession')
      commandLines.push('$stopped = Wait-NovaWinRtOperation $session.TryStopAsync() ([bool])')
      commandLines.push("if (-not $stopped) { throw 'The active media player did not accept the stop request.' }")
      commandLines.push("Write-NovaResult 'stop' 'Stopped playback.'")
    } else if (command.action === 'list-output-devices') {
      commandLines.push("$outputDevices = $global:NovaAudioType.GetMethod('ListOutputDevices').Invoke($null, [object[]]@())")
      commandLines.push("Write-NovaResult 'list-output-devices' $outputDevices")
    } else if (command.action === 'list-audio-apps') {
      commandLines.push("$audioApps = $global:NovaAudioType.GetMethod('ListAudioApps').Invoke($null, [object[]]@())")
      commandLines.push("Write-NovaResult 'list-audio-apps' $audioApps")
    } else if (command.action === 'set-output-device') {
      commandLines.push(`$deviceName = $global:NovaAudioType.GetMethod('SetDefaultOutputDevice').Invoke($null, [object[]]@(${quotePowerShellString(command.device as string)}))`)
      commandLines.push("Write-NovaResult 'set-output-device' $deviceName")
    } else if (command.action === 'set-app-volume') {
      const volume = command.volume as number
      commandLines.push(`$sessionsChanged = $global:NovaAudioType.GetMethod('SetApplicationVolume').Invoke($null, [object[]]@(${quotePowerShellString(command.app as string)}, [single]${(volume / 100).toString()}))`)
      commandLines.push(`Write-NovaResult 'set-app-volume' ([pscustomobject]@{ app = ${quotePowerShellString(command.app as string)}; volume = ${volume}; sessions = $sessionsChanged })`)
    }
  }

  if (commands.some(({ action }) => mediaActions[action])) {
    setupLines.unshift('$global:NovaMediaKeyType = Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public static class NovaMediaKey { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo); }\' -PassThru | Select-Object -First 1')
  }
  const compressed = gzipSync(Buffer.from(JSON.stringify({
    setup: setupLines.join('\n'),
    commands: commandLines.join('\n'),
    needsAudioControl,
    needsMediaKeys: commands.some(({ action }) => mediaActions[action])
  }), 'utf8')).toString('base64')
  const bootstrap = [
    '$ErrorActionPreference = \'Stop\'',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    `$bytes = [Convert]::FromBase64String('${compressed}')`,
    '$stream = [IO.MemoryStream]::new($bytes)',
    '$gzip = [IO.Compression.GzipStream]::new($stream, [IO.Compression.CompressionMode]::Decompress)',
    '$reader = [IO.StreamReader]::new($gzip, [Text.Encoding]::UTF8)',
    '$payload = $reader.ReadToEnd() | ConvertFrom-Json',
    '$reader.Dispose()',
    'function Write-NovaResult($action, $result) { Write-Output (\'NOVA_RESULT:\' + (ConvertTo-Json -InputObject ([pscustomobject]@{ action = $action; result = $result }) -Compress -Depth 4)) }',
    'try {',
    '  if ($payload.setup) { Invoke-Expression ([string]$payload.setup) }',
    '  if ($payload.needsAudioControl -and -not $global:NovaAudioType) { throw \'Windows audio helper type was not loaded.\' }',
    '  if ($payload.needsMediaKeys -and -not $global:NovaMediaKeyType) { throw \'Windows media-key helper type was not loaded.\' }',
    '  Invoke-Expression ([string]$payload.commands)',
    '  exit 0',
    '} catch { $errorRecord = $_; $line = if ($errorRecord.InvocationInfo) { $errorRecord.InvocationInfo.Line } else { \'(no line information)\' }; [Console]::WriteLine(\'NOVA_ERROR:\' + $errorRecord.Exception.Message + \' | LINE: \' + $line); exit 1 }'
  ].join('\n')
  const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64')
  await new Promise<void>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout = `${stdout}${chunk.toString()}`.slice(-16_000) })
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
      if (code !== 0) {
        const errorStart = stdout.indexOf('NOVA_ERROR:')
        const error = errorStart >= 0
          ? stdout.slice(errorStart + 'NOVA_ERROR:'.length).trim()
          : stderr.trim() || `exit ${code}`
        reject(new Error(`Windows media control failed: ${error}.`))
        return
      }
      try {
        let reportedResults = 0
        for (const line of stdout.split(/\r?\n/)) {
          if (!line.startsWith('NOVA_RESULT:')) continue
          const { action, result } = JSON.parse(line.slice('NOVA_RESULT:'.length)) as { action: string; result: unknown }
          reportedResults += 1
          if (action === 'get-status') {
            if (!result || typeof result !== 'object') throw new Error('The Windows media player returned invalid status data.')
            summaries.push(`media status: ${mediaStatusSummary(result as Record<string, unknown>)}`)
          } else if (action === 'list-output-devices') {
            if (!Array.isArray(result)) throw new Error('Windows returned an invalid output-device list.')
            summaries.push(`available output devices: ${result.join('; ') || 'none'}`)
          } else if (action === 'list-audio-apps') {
            if (!Array.isArray(result)) throw new Error('Windows returned an invalid audio-app list.')
            summaries.push(`apps with active audio sessions: ${result.join('; ') || 'none'}`)
          } else if (action === 'set-output-device') {
            if (typeof result !== 'string' || !result) throw new Error('Windows did not confirm the output-device change.')
            summaries.push(`set default output device to ${String(result)}`)
          } else if (action === 'set-app-volume') {
            if (!result || typeof result !== 'object') throw new Error('Windows returned an invalid application-volume result.')
            const appResult = result as { app?: unknown; volume?: unknown; sessions?: unknown }
            if (typeof appResult.sessions !== 'number' || appResult.sessions < 1) {
              throw new Error('The Windows audio API did not confirm an application volume change.')
            }
            summaries.push(`set ${String(appResult.app)} volume to ${String(appResult.volume)}% across ${String(appResult.sessions)} audio session(s)`)
          } else if (action === 'stop') {
            if (result !== 'Stopped playback.') throw new Error('The Windows media player did not confirm that playback stopped.')
            summaries.push('stopped media playback')
          } else if (action === 'seek-forward' || action === 'seek-backward') {
            if (!result || typeof result !== 'object') throw new Error('The Windows media player returned an invalid seek result.')
            const position = Number((result as { positionSeconds?: unknown }).positionSeconds)
            if (!Number.isFinite(position)) throw new Error('The Windows media player returned an invalid seek position.')
            summaries.push(`seeked ${action === 'seek-forward' ? 'forward' : 'back'} to ${Math.floor(position / 60)}:${String(Math.floor(position % 60)).padStart(2, '0')}`)
          } else {
            throw new Error(`Windows media control returned an unexpected result for ${action}.`)
          }
        }
        const expectedResults = commands.filter(({ action }) => [
          'get-status', 'seek-forward', 'seek-backward', 'stop', 'list-output-devices',
          'set-output-device', 'list-audio-apps', 'set-app-volume'
        ].includes(action)).length
        if (reportedResults !== expectedResults) throw new Error('Windows media control did not return all requested results.')
      } catch (error) {
        reject(new Error(`Windows media control returned an invalid result: ${error instanceof Error ? error.message : String(error)}`))
        return
      }
      resolve()
    })
  })
  return `Windows media controls: ${summaries.join('; ')}.`
}
