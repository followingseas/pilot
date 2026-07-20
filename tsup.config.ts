import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/index.ts', 'src/mcp/server.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  banner: { js: '' }
})
