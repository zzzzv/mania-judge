import { HIT_RESULTS } from '../types'
import type {
  Columns,
  HitResult,
  HitResultTable,
  JudgementV1,
} from '../types'
import { compareJudgements, isHoldJudgement } from '../extensions'
import { difficultyRange } from '../utils'

function getLifeIncreaseFor(result: HitResult, hp: number, hpMultiplierNormal = 1) {
  switch (result) {
    case HIT_RESULTS.Perfect:
      return hpMultiplierNormal * (0.0055 - hp * 0.0005)
    case HIT_RESULTS.Great:
      return hpMultiplierNormal * (0.005 - hp * 0.0005)
    case HIT_RESULTS.Good:
      return hpMultiplierNormal * (0.004 - hp * 0.0004)
    case HIT_RESULTS.Ok:
      return 0
    case HIT_RESULTS.Meh:
      return -(hp + 1) * 0.0016
    case HIT_RESULTS.Miss:
      return -(hp + 1) * 0.0075
  }
}

export function computeHpMultiplierNormal(judgementColumns: Columns<JudgementV1>, hp: number) {
  const sortedByStart = judgementColumns
    .flat()
    .sort((left, right) => left.note.start - right.note.start || compareJudgements(left, right))

  if (sortedByStart.length === 0) {
    return 1
  }

  const hpRecoveryAvailable = difficultyRange(hp, 0.04, 0.02, 0)

  let hpMultiplierNormal = 1

  while (true) {
    let currentHpUncapped = 1

    for (const judgement of sortedByStart) {
      if (isHoldJudgement(judgement)) {
        for (const _tickTime of judgement.ticks) {
          const tickIncrease = getLifeIncreaseFor(HIT_RESULTS.Great, hp, hpMultiplierNormal)
          currentHpUncapped += tickIncrease
        }
      }

      const topLevelIncrease = getLifeIncreaseFor(HIT_RESULTS.Perfect, hp, hpMultiplierNormal)
      currentHpUncapped += topLevelIncrease
    }

    const recovery = (currentHpUncapped - 1) / Math.max(1, sortedByStart.length)

    if (recovery < hpRecoveryAvailable) {
      hpMultiplierNormal *= 1.01
      continue
    }

    return hpMultiplierNormal
  }
}

export function createLifeTable(hp: number, hpMultiplierNormal = 1): HitResultTable<number> {
  return [
    getLifeIncreaseFor(HIT_RESULTS.Perfect, hp, hpMultiplierNormal),
    getLifeIncreaseFor(HIT_RESULTS.Great, hp, hpMultiplierNormal),
    getLifeIncreaseFor(HIT_RESULTS.Good, hp, hpMultiplierNormal),
    getLifeIncreaseFor(HIT_RESULTS.Ok, hp, hpMultiplierNormal),
    getLifeIncreaseFor(HIT_RESULTS.Meh, hp, hpMultiplierNormal),
    getLifeIncreaseFor(HIT_RESULTS.Miss, hp, hpMultiplierNormal),
  ]
}