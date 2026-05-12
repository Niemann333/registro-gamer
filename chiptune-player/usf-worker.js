import CHIP_CORE_init from './chip-core.js';

let CC = null;
let renderBufPtr = 0;
const RENDER_SAMPLES = 4096;

// Encontra _lib tag no PSF
function findLibTag(data) {
  if (data[0] !== 0x50 || data[1] !== 0x53 || data[2] !== 0x46) return null;
  const rlen = data[4]|(data[5]<<8)|(data[6]<<16)|(data[7]<<24);
  const clen = data[8]|(data[9]<<8)|(data[10]<<16)|(data[11]<<24);
  const ts = 16 + rlen + clen;
  if (ts + 5 >= data.length) return null;
  if (data[ts]!==0x5B||data[ts+1]!==0x54||data[ts+2]!==0x41||data[ts+3]!==0x47||data[ts+4]!==0x5D) return null;
  const tags = new TextDecoder().decode(data.slice(ts + 5));
  for (const line of tags.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0 && line.slice(0, eq).trim().toLowerCase() === '_lib')
      return line.slice(eq + 1).trim();
  }
  return null;
}

async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return new Uint8Array(await r.arrayBuffer());
}

async function loadSong(url) {
  postMessage({type: 'status', text: 'Carregando...'});

  try { CC._n64_shutdown(); } catch(e) {}

  const filename = decodeURIComponent(url.split('/').pop());
  const isMini = /\.miniusf$/i.test(filename);
  const dirUrl = url.replace(/\/[^/]+$/, '');

  const songData = await fetchBin(url);

  if (isMini) {
    const libName = findLibTag(songData);
    if (libName) {
      postMessage({type: 'status', text: 'Carregando lib...'});
      try {
        const libData = await fetchBin(dirUrl + '/' + encodeURIComponent(libName));
        try { CC.FS.unlink('/' + libName); } catch(e) {}
        CC.FS.writeFile('/' + libName, libData);
        postMessage({type: 'log', text: 'lib in FS: ' + libName + ' (' + libData.length + 'b)'});
        const r = CC.ccall('n64_load_file','number',['string','number','number','number'],
          ['/' + libName, 1, 0, 0]);
        postMessage({type: 'log', text: 'lib ret: ' + r});
      } catch(e) { postMessage({type: 'log', text: 'lib error: ' + e.message}); }
    }
  }

  try { CC.FS.unlink('/song.usf'); } catch(e) {}
  CC.FS.writeFile('/song.usf', songData);
  postMessage({type: 'status', text: 'Iniciando emulador...'});

  let ret;
  try {
    ret = CC.ccall('n64_load_file','number',['string','number','number','number'],
      ['/song.usf', 0, 0, 0]);
  } catch(e) {
    postMessage({type: 'error', text: 'n64_load_file falhou: ' + e.message});
    return;
  }
  postMessage({type: 'log', text: 'song ret: ' + ret});

  if (ret !== 0) {
    postMessage({type: 'error', text: 'Erro ao carregar (' + ret + ')'});
    return;
  }

  const name = filename.replace(/\.[^.]+$/, '');
  postMessage({type: 'loaded', name});
}

function renderChunk() {
  if (!renderBufPtr) renderBufPtr = CC._malloc(RENDER_SAMPLES * 4);
  try {
    CC._n64_render_audio(renderBufPtr, RENDER_SAMPLES);
  } catch(e) {
    postMessage({type: 'log', text: 'render error: ' + e.message});
    return;
  }
  const raw = new Int16Array(CC.HEAP16.buffer, renderBufPtr, RENDER_SAMPLES * 2);
  const L = new Float32Array(RENDER_SAMPLES);
  const R = new Float32Array(RENDER_SAMPLES);
  for (let i = 0; i < RENDER_SAMPLES; i++) {
    L[i] = raw[i * 2] / 32768;
    R[i] = raw[i * 2 + 1] / 32768;
  }
  let pos = 0, dur = 0;
  try { pos = CC._n64_get_position_ms(); dur = CC._n64_get_duration_ms(); } catch(e) {}
  postMessage({type: 'audio', L, R, pos, dur}, [L.buffer, R.buffer]);
}

self.addEventListener('message', async e => {
  const d = e.data;
  if (d.type === 'load') await loadSong(d.url);
  if (d.type === 'render') renderChunk();
  if (d.type === 'seek') { try { CC._n64_seek_ms(d.ms); } catch(e) {} }
  if (d.type === 'stop') { /* rendering stops when no 'render' requests come */ }
});

// Init
(async () => {
  CC = await CHIP_CORE_init({
    locateFile: p => p === 'chip-core.wasm'
      ? new URL('./chip-core.wasm', self.location.href).href : p
  });
  postMessage({type: 'ready'});
})();
