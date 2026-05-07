import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/osu-parsers/index.ts', 'src/osu-parsers/node.ts'],
  dts: {
    tsgo: true,
  },
  exports: true,
  // ...config options
})
