import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Distinct from demo/'s default (5173) and demo-gml's (5174) so all three can run at once.
  server: {
    port: 5175,
  },
  resolve: {
    alias: {
      // Force all code (including ../lib) to share one @luciad/ria instance.
      // Only needed because the lib is loaded from a sibling dir in local dev;
      // published npm consumers share one node_modules naturally.
      '@luciad/ria': path.resolve(__dirname, 'node_modules/@luciad/ria'),
      'ria-wfststore': path.resolve(__dirname, '../lib/index.js'),
    },
  },
})
