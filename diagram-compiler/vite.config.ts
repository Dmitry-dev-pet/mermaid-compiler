import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { openCodeGoPlugin } from './server/openCodeGoVitePlugin';

export default defineConfig(({ mode }) => {
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), openCodeGoPlugin()],
    optimizeDeps: {
      // Mermaid uses dynamic imports for diagram modules (e.g. classDiagram).
      // When deps were updated, Vite can serve stale optimized chunks until the
      // optimizer is re-run. Force re-optimization in dev to avoid 404s.
      force: mode === 'development',
      // Mermaid's gantt renderer imports dayjs + plugins as CJS/UMD modules.
      // Pre-bundle them so Vite provides proper ESM interop exports.
      include: [
        'dayjs',
        'dayjs/plugin/isoWeek',
        'dayjs/plugin/customParseFormat',
        'dayjs/plugin/advancedFormat',
        'dayjs/plugin/duration',
        '@braintree/sanitize-url',
      ],
      needsInterop: ['dayjs', '@braintree/sanitize-url'],
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      // Keep React singletons, but allow mermaid-to-excalidraw to use its
      // pinned Mermaid dependency (v10.x) so conversions stay stable.
      dedupe: ['react', 'react-dom'],
    },
  };
});
