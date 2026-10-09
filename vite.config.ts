import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * GLSL imported with `?raw`, minified in production builds: comments and
 * indentation go, statements are joined, and spaces around punctuation are
 * dropped. Preprocessor lines keep their own lines; spaces around + and - stay
 * (so `a - -b` never becomes the `--` operator). Dev serves the sources as is.
 */
function glslMinify(): Plugin {
  const shader = /\.(glsl|vert|frag)\?raw$/;
  const minify = (src: string) => {
    const lines = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let out = '';
    for (const l of lines) {
      if (l.startsWith('#')) out += `${out && !out.endsWith('\n') ? '\n' : ''}${l.replace(/\s+/g, ' ')}\n`;
      else out += `${l.replace(/\s+/g, ' ').replace(/\s*([{}()[\];,=<>*/!&|?:])\s*/g, '$1')} `;
    }
    return out.replace(/ ([{}])/g, '$1').trim();
  };
  return {
    name: 'glsl-minify',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      if (!shader.test(id)) return null;
      const file = id.replace(/\?raw$/, '');
      return `export default ${JSON.stringify(minify(readFileSync(file, 'utf8')))};`;
    },
  };
}

/** Preload the faces visible on first paint, so the loader is not left waiting for them. */
function preloadFonts(): Plugin {
  const wanted = /(manrope-latin-wght|Cygre-Regular|Cygre-Bold|AkkuratMono-Regular)-[\w-]+\.woff2$/;
  return {
    name: 'preload-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        return Object.keys(ctx.bundle)
          .filter((f) => wanted.test(f))
          .map((f) => ({
            tag: 'link',
            attrs: { rel: 'preload', href: `/${f}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}

export default defineConfig({
  plugins: [glslMinify(), preloadFonts()],
  server: { port: 5190, host: true },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // three.js is one long-cached chunk (~133 kB gzip); everything else is far below this.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep three in its own long-cached chunk, apart from the app code that changes more often.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
