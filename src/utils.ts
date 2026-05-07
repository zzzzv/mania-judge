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