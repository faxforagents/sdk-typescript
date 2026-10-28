// Provenance: livetennisapi-oss/livetennisapi-js/tsup.config.ts (2026-10-28).
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // Zero runtime dependencies: fetch and Web Crypto come from the platform (Node 18+, browsers, edge).
});
