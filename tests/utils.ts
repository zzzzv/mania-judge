import { access } from 'node:fs/promises'

import JSZip from 'jszip'

const INDENT = '  '

const isPrimitive = (value: unknown): value is string | number | boolean | null => {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

const isInlineArray = (value: unknown): value is unknown[] => {
  return Array.isArray(value) && value.length <= 8 && value.every(isPrimitive)
}

const isInlineObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return false
  }

  const entries = Object.entries(value)
  return entries.length > 0 && entries.length <= 4 && entries.every(([, item]) => item === undefined || isPrimitive(item))
}

export const sanitizeFileNamePart = (value: string) => {
  return value
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const formatJson = (value: unknown, depth: number = 0): string => {
  if (value === undefined) {
    return 'null'
  }

  if (isPrimitive(value)) {
    return JSON.stringify(value)
  }

  if (isInlineArray(value)) {
    return `[${value.map((item) => formatJson(item, depth)).join(', ')}]`
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]'
    }

    const currentIndent = INDENT.repeat(depth)
    const nextIndent = INDENT.repeat(depth + 1)
    const items = value.map((item) => `${nextIndent}${formatJson(item, depth + 1)}`)
    return `[
${items.join(',\n')}
${currentIndent}]`
  }

  if (isInlineObject(value)) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `${JSON.stringify(key)}: ${formatJson(item, depth)}`)
    return `{ ${entries.join(', ')} }`
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)

  if (entries.length === 0) {
    return '{}'
  }

  const currentIndent = INDENT.repeat(depth)
  const nextIndent = INDENT.repeat(depth + 1)
  const lines = entries.map(([key, item]) => `${nextIndent}${JSON.stringify(key)}: ${formatJson(item, depth + 1)}`)
  return `{
${lines.join(',\n')}
${currentIndent}}`
}

export const pathExists = async (filePath: string) => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export const createSilentWav = (durationMs: number = 250) => {
  const sampleRate = 44100
  const channelCount = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1000))
  const dataSize = sampleCount * channelCount * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channelCount, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28)
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

export const createZipArchive = async (
  archivePath: string,
  entries: { name: string, content: string | Uint8Array | Buffer }[],
) => {
  const zip = new JSZip()

  for (const entry of entries) {
    zip.file(entry.name, entry.content)
  }

  const archive = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  })

  await import('node:fs/promises').then(({ writeFile }) => writeFile(archivePath, archive))
}