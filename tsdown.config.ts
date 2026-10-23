import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'runtime/index': 'src/runtime/index.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: true,
  outDir: 'dist',
  fixedExtension: true,
});
