import * as esbuild from 'esbuild';
import path from 'path';
const stub = (name) => path.resolve('stubs', name);
await esbuild.build({
  entryPoints: ['entry.js'], bundle: true, format: 'iife', minify: true, target: ['es2020'],
  outfile: 'out/chip-players.js', define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [path.resolve('node_modules')],
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /(^|\/)config$/ }, () => ({ path: stub('config.js') }));
    b.onResolve({ filter: /^redaxios$/ }, () => ({ path: stub('redaxios.js') }));
    b.onResolve({ filter: /^utf-8$/ }, () => ({ path: stub('utf8.js') }));
  } }],
  banner: { js: '/* Players do Chip Player JS (github.com/mmontag/chip-player-js, GPL-3.0) empacotados para o Registro Gamer */' },
});
console.log('ok');
