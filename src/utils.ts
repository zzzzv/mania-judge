import { HIT_RESULTS } from './types'
import type {
  HitResultTable,
  HitWindows,
} from './types'

const epsilon = 1e-6

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function difficultyRange(difficulty: number, min: number, mid: number, max: number): number {
  if (difficulty > 5) {
    return mid + (max - mid) * ((difficulty - 5) / 5)
  }
  if (difficulty < 5) {
    return mid + (mid - min) * ((difficulty - 5) / 5)
  }
  return mid
}

export function truncWindows(windows: Readonly<HitWindows>, scale: number = 1): HitWindows {
  const truncated: HitWindows = [...windows]
  for (let i = 0; i < truncated.length; i++) {
    truncated[i] = Math.trunc(truncated[i] * scale + epsilon)
  }
  return truncated
}

export function calcAccuracy(
  resultCounts: Readonly<HitResultTable<number>>,
  accTable: Readonly<HitResultTable<number>>
): number {
  let total = 0
  let acc = 0
  for (let i = HIT_RESULTS.Perfect; i <= HIT_RESULTS.Miss; i++) {
    total += resultCounts[i]
    acc += resultCounts[i] * accTable[i]
  }
  return total > 0 ? acc / total : 0
}