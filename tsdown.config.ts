import { defineConfig } from 'tsdown';

export default defineConfig({
  // catalog is a separate entry so tooling (docs generation) can import the tool
  // definitions without starting the server
  entry: { index: 'src/index.ts', catalog: 'src/tools/catalog.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  outDir: 'dist',
});
