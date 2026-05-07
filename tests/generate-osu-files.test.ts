import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { parseWithMods } from '../src/osu-parsers/shared'
import { generateFiles, readFixture } from './generate-osu-files'

const sourceFixturePath = path.resolve(
  import.meta.dirname,
  'fixtures/json/tap-only/雪月夜鐘 [widest]-Lv.24-90.66.json',
)

describe('generate-files', () => {
  it('generates round-trippable osu/osr/osz files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mania-judge-'))

    try {
      const tempFixturePath = path.join(tempDir, path.basename(sourceFixturePath))
      const sourceContent = await readFile(sourceFixturePath, 'utf8')
      await writeFile(tempFixturePath, sourceContent)

      const fixture = await readFixture(tempFixturePath)
      const result = await generateFiles(tempDir)
      const generated = result.generated[0]
      const [archiveBuffer, replayBuffer] = await Promise.all([
        readFile(generated.oszPath),
        readFile(generated.osrPath),
      ])
      const archive = await JSZip.loadAsync(archiveBuffer)
      const beatmapFile = archive.file(`${generated.fixtureName}.osu`)

      if (!beatmapFile) {
        throw new Error('Generated archive does not contain a beatmap file.')
      }

      const beatmapContent = await beatmapFile.async('string')
      const parsed = await parseWithMods(beatmapContent, replayBuffer)

      expect(result.generated).toHaveLength(1)
      expect(parsed.osuData).toEqual(fixture.osuData)
      expect(archive.file(`${generated.fixtureName}.osu`)).toBeTruthy()
      expect(archive.file('silence.wav')).toBeTruthy()
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})