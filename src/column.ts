import type { Action } from './types'

export function createActionCursor(actions: Action[]) {
  let index = 0
  let time = Number.MIN_SAFE_INTEGER
  let holdingAction: Action | null = null

  return {
    get time() {
      return time
    },
    setNextTime(nextTime: number) {
      if (nextTime > time) {
        time = nextTime
        while (index < actions.length && actions[index].release < time) {
          index++
        }
        if (index < actions.length && actions[index].press < time) {
          holdingAction = actions[index++]
        } else {
          holdingAction = null
        }
      }
    },
    getHoldingAction() {
      return holdingAction
    },
    getNextAction() {
      if (index < actions.length) {
        return actions[index]
      }
      return null
    },
  }
}

export type ActionCursor = ReturnType<typeof createActionCursor>