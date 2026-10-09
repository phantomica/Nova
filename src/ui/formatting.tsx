import type { ReactNode } from 'react'
import type { PendingChange } from '../shared'

function inlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const tokens = /(\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|~~[^~]+~~|`[^`]+`)/g
  const nodes: React.ReactNode[] = []
  let start = 0
  let match: RegExpExecArray | null
  while ((match = tokens.exec(text))) {
    if (match.index > start) nodes.push(text.slice(start, match.index))
    const token = match[0]
    const content = token.slice(token.startsWith('**') || token.startsWith('__') || token.startsWith('~~') ? 2 : 1,
      token.startsWith('**') || token.startsWith('__') || token.startsWith('~~') ? -2 : -1)
    const key = `${keyPrefix}-${match.index}`
    if (token.startsWith('**') || token.startsWith('__')) nodes.push(<strong key={key}>{content}</strong>)
    else if (token.startsWith('~~')) nodes.push(<del key={key}>{content}</del>)
    else if (token.startsWith('`')) nodes.push(<code key={key}>{content}</code>)
    else nodes.push(<em key={key}>{content}</em>)
    start = match.index + token.length
  }
  if (start < text.length) nodes.push(text.slice(start))
  return nodes
}

/** Render the Markdown subset Nova supports without interpreting raw HTML. */
function ChatText({ children }: { children: string }) {
  const lines = children.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' = 'ul'
  const flushList = () => {
    if (!listItems.length) return
    const List = listType
    blocks.push(<List key={`list-${blocks.length}`}>{listItems.map((item, index) =>
      <li key={index}>{inlineMarkdown(item, `list-${blocks.length}-${index}`)}</li>)}</List>)
    listItems = []
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      flushList()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++])
      blocks.push(<pre key={`code-${index}`}><code>{codeLines.join('\n')}</code></pre>)
      continue
    }
    const listItem = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line)
    if (listItem) {
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul'
      if (listItems.length && type !== listType) flushList()
      listType = type
      listItems.push(listItem[1])
      continue
    }
    flushList()
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push(<h4 key={`heading-${index}`}>{inlineMarkdown(heading[2], `heading-${index}`)}</h4>)
    } else if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={`rule-${index}`} />)
    } else if (/^\s*>\s?/.test(line)) {
      blocks.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(line.replace(/^\s*>\s?/, ''), `quote-${index}`)}</blockquote>)
    } else if (line.trim()) {
      blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(line, `paragraph-${index}`)}</p>)
    } else {
      blocks.push(<br key={`break-${index}`} />)
    }
  }
  flushList()
  return <div className="chat-text">{blocks}</div>
}

/** Remove presentation syntax while preserving the words and links spoken aloud. */
function plainTextForSpeech(markdown: string) {
  return markdown
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Produce a bounded line diff for previews; large proposals never allocate an unbounded matrix. */
function lineDiff(before: string | null, after: string | null) {
  const left = (before === null ? [] : before.split('\n')).slice(0, 100)
  const right = (after === null ? [] : after.split('\n')).slice(0, 100)
  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      rows[i][j] = left[i] === right[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1])
    }
  }
  const result: Array<{ kind: 'same' | 'removed' | 'added'; text: string }> = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      result.push({ kind: 'same', text: left[i] })
      i += 1
      j += 1
    } else if (rows[i + 1][j] >= rows[i][j + 1]) {
      result.push({ kind: 'removed', text: left[i++] })
    } else {
      result.push({ kind: 'added', text: right[j++] })
    }
  }
  while (i < left.length) result.push({ kind: 'removed', text: left[i++] })
  while (j < right.length) result.push({ kind: 'added', text: right[j++] })
  return {
    lines: result,
    truncated: (before?.split('\n').length ?? 0) > 100 || (after?.split('\n').length ?? 0) > 100
  }
}

/** Decode a browser recording and resample it to Whisper's mono 16 kHz input format. */
async function decodeForWhisper(blob: Blob) {
  const input = new AudioContext()
  try {
    const decoded = await input.decodeAudioData(await blob.arrayBuffer())
    const frames = Math.ceil(decoded.duration * 16_000)
    if (!frames) throw new Error('No audio was recorded. Try speaking closer to the microphone.')
    const output = new OfflineAudioContext(1, frames, 16_000)
    const source = output.createBufferSource()
    source.buffer = decoded
    source.connect(output.destination)
    source.start()
    return (await output.startRendering()).getChannelData(0).slice()
  } finally {
    await input.close()
  }
}


export { ChatText, decodeForWhisper, lineDiff, plainTextForSpeech }
