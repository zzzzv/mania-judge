import { readFile } from 'node:fs/promises'

import { convertBeatmap, convertReplay, parseWithMods } from './shared'

const parseFromPath = async (beatmapPath: string, replayPath: string) => {
  const [beatmapContent, replayBuffer] = await Promise.all([
    readFile(beatmapPath, 'utf8'),
    readFile(replayPath),
  ])

  return parseWithMods(beatmapContent, replayBuffer)
}

export { convertBeatmap, convertReplay, parseWithMods, parseFromPath }