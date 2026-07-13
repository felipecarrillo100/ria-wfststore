import { defineConfig } from 'tsup'
import path from 'path'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/WFSCapabilitiesExtended.ts',
    'src/WFSTFeatureStore.ts',
    'src/WFSTFeatureLockStore.ts',
  ],
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  external: ['@luciad/ria', 'lodash'],
  esbuildOptions(options) {
    // Bundle xmlbuilder2's pre-built webpack bundle instead of its raw CJS source.
    // The raw source requires Node built-ins (url, events) via @oozcitak/* deps,
    // which esbuild's CJS shim can't satisfy in a browser context.
    // The min.js has those already bundled by webpack with browser polyfills.
    options.alias = {
      ...options.alias,
      'xmlbuilder2': path.resolve('node_modules/xmlbuilder2/lib/xmlbuilder2.min.js'),
    }
  },
})
