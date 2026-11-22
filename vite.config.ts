import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function buildSpa404Html(normalizedBase: string): string {
  const pathSegmentsToKeep = normalizedBase.split('/').filter(Boolean).length;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Redirecting…</title>
    <script>
      (function () {
        var pathSegmentsToKeep = ${pathSegmentsToKeep};
        var fallbackBase = ${JSON.stringify(normalizedBase)};
        var l = window.location;
        var origin = l.protocol + '//' + l.hostname + (l.port ? ':' + l.port : '');
        var segments = l.pathname.split('/');
        if (segments.length <= 1 + pathSegmentsToKeep) {
          l.replace(origin + fallbackBase + l.search + l.hash);
          return;
        }
        var rootPrefix = segments.slice(0, 1 + pathSegmentsToKeep).join('/');
        var routePath = segments
          .slice(1 + pathSegmentsToKeep)
          .join('/')
          .replace(/&/g, '~and~');
        var query = l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '';
        l.replace(origin + rootPrefix + '/?/' + routePath + query + l.hash);
      })();
    </script>
  </head>
  <body></body>
</html>
`;
}

export default defineConfig(() => {
  const rawBase = (process.env.VITE_BASE_PATH || '/').trim() || '/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  return {
    base: normalizedBase,
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs still resolve
      // in production builds, and emits GitHub Pages SPA 404.html + .nojekyll.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(rootDir, 'dist');
          const srcAssets = path.resolve(rootDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(path.resolve(distDir, '404.html'), buildSpa404Html(normalizedBase));
            fs.writeFileSync(path.resolve(distDir, '.nojekyll'), '');
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
