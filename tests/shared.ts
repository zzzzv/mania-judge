import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { formatJson, sanitizeFileNamePart } from './utils'
import type { FixtureOutput } from './fixture-types'

// ── Condition types & groups ──────────────────────────────────────────

export interface QueryCondition {
  holdRatioRange: [number, number]
  accuracyRange: [number, number]
  count: number
  mods: string[]
}

export type ConditionGroupName = 'tap-only' | 'hold' | 'mods'

export const CONDITION_GROUPS: Record<ConditionGroupName, QueryCondition[]> = {
  'tap-only': [
    { holdRatioRange: [0, 0], accuracyRange: [0.9, 0.919999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0, 0], accuracyRange: [0.92, 0.939999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0, 0], accuracyRange: [0.94, 0.959999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0, 0], accuracyRange: [0.96, 0.98], count: 10, mods: ['NM'] },
  ],
  'hold': [
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.9, 0.919999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.92, 0.939999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.94, 0.959999], count: 10, mods: ['NM'] },
    { holdRatioRange: [0.3, 0.7], accuracyRange: [0.96, 0.98], count: 10, mods: ['NM'] },
  ],
  'mods': [
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['EZ'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['HR'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['MR'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['DT'] },
    { holdRatioRange: [0, 1], accuracyRange: [0.9, 1], count: 5, mods: ['HT'] },
  ],
}

export const isConditionGroupName = (value: string): value is ConditionGroupName => {
  return value in CONDITION_GROUPS
}

// ── Validation ────────────────────────────────────────────────────────

export const validateConditions = (conditions: QueryCondition[]) => {
  for (const condition of conditions) {
    if (condition.holdRatioRange[0] > condition.holdRatioRange[1]) {
      throw new Error('holdRatioRange must be in ascending order.')
    }

    if (condition.accuracyRange[0] > condition.accuracyRange[1]) {
      throw new Error('accuracyRange must be in ascending order.')
    }

    if (!Number.isInteger(condition.count) || condition.count <= 0) {
      throw new Error('count must be a positive integer.')
    }
  }
}

// ── Output helpers ────────────────────────────────────────────────────

export const createOutputFileName = (output: FixtureOutput) => {
  const titlePart = sanitizeFileNamePart(output.title || 'untitled')
  const difficultyPart = sanitizeFileNamePart(output.difficulty || 'difficulty')
  return `${titlePart}-${difficultyPart}-${(output.scoreInfo.accuracy * 100).toFixed(2)}.json`
}

export const writeOutputs = async (outputDir: string, outputs: FixtureOutput[]) => {
  await mkdir(outputDir, { recursive: true })

  const filePaths: string[] = []
  for (const output of outputs) {
    const outputPath = path.join(outputDir, createOutputFileName(output))
    await writeFile(outputPath, `${formatJson(output)}\n`)
    filePaths.push(outputPath)
  }

  return filePaths
}
