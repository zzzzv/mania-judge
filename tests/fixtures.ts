import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** 样本根目录：`tests/fixtures/`（不入库，见 `.gitignore`）。 */
export const fixturesRoot = path.resolve(import.meta.dirname, 'fixtures')

let hinted = false

/**
 * 列出某组样本的文件名（升序）。
 *
 * 样本是要本机生成的，新克隆的仓库里没有。目录缺失时返回空数组并**提示一次**生成方式，
 * 让测试注册成跳过，而不是在模块顶层 `readdirSync` 直接 ENOENT 崩掉。
 */
export function fixtureNames(kind: 'stable' | 'lazer', group: string): string[] {
  const dir = path.join(fixturesRoot, kind, group)

  if (!existsSync(dir)) {
    if (!hinted) {
      hinted = true
      console.warn(
        `\n[mania-judge] 缺少样本目录 ${path.relative(process.cwd(), dir)}，相关测试会跳过。\n`
        + '  生成 stable 样本：cp .env.example .env（填好 OSU_STABLE_DIR）后 pnpm gen:stable-json\n'
        + '  生成 lazer 样本 ：pnpm gen:lazer-index（需要本地 lazer）后 pnpm gen:lazer-json\n',
      )
    }

    return []
  }

  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
}
