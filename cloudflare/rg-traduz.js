/* Registro Gamer — tradução das postagens (Cloudflare Worker "rg-traduz")
 *
 * GET /?post=<id do post>            → { titulo, html }   (post inteiro em inglês)
 * GET /?post=<id do post>&so=titulo  → { titulo }         (só o título, para listas)
 * GET /?status=1                     → andamento do robô que traduz o blog inteiro
 * GET /?robo=1                       → roda um lote do robô agora (sem esperar o horário)
 *
 * O Worker não aceita texto de fora: ele mesmo busca o post no Blogger pelo id e traduz.
 * Assim ninguém consegue usar a sua cota da DeepL para traduzir outras coisas.
 * Cada tradução fica guardada no KV (TRAD) com a data da última edição do post:
 * o post só é traduzido de novo se você editar ele.
 *
 * Robô (Cron Trigger): de tempos em tempos traduz um lote de posts que ainda não têm tradução,
 * do mais novo para o mais antigo, até acabar o blog ou a cota da DeepL. Depois continua
 * passando pelo blog para pegar posts novos ou editados.
 *
 * Configuração no painel do Cloudflare (Worker rg-traduz → Settings):
 *   • Variables and Secrets → Secret  DEEPL_KEY = sua chave da API da DeepL
 *   • Bindings → KV namespace          TRAD      = rg-traducoes
 *   • Trigger events → Cron Trigger    a cada 15 minutos  (para o robô)
 */
const BLOG = 'https://lucniemanngames.blogspot.com';
const ORIGENS = /^https:\/\/(lucniemanngames\.blogspot\.com|www\.lucniemanngames\.blogspot\.com|niemann333\.github\.io)$/;
const MAX_HTML = 120000;   // a DeepL aceita até ~128 KB por pedido
const LOTE_POSTS = 25;     // posts lidos do Blogger por vez
const LOTE_TRAD = 8;       // traduções por vez (o Cloudflare gratuito limita os pedidos de cada execução)
const K_ROBO = 'robo:estado';

// A DeepL, em inglês, troca muitas vírgulas por travessão ("around 11 years old—Luis had a PC").
// Aqui o travessão volta a ser vírgula, como no texto original. Vale também para o que já estava guardado.
function semTravessao(t) {
  return String(t || '')
    .replace(/\s*[—―]\s*/g, ', ')            // — (travessão)
    .replace(/(\S)\s+–\s+(\S)/g, '$1, $2')        // – (meia-risca com espaços)
    .replace(/,\s*([.,;:!?)])/g, '$1')                    // vírgula antes de outra pontuação
    .replace(/([(>"“])\s*,\s*/g, '$1')              // vírgula logo no começo
    .replace(/,\s*(<\/(p|div|li|h\d)>)/gi, '$1');        // vírgula no fim do parágrafo
}
function limpo(o) {
  const out = { titulo: semTravessao(o.titulo) };
  if (o.html != null) out.html = semTravessao(o.html);
  return out;
}

function resposta(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
}

// Pede a tradução à DeepL. Chave gratuita (terminada em ":fx") usa o endereço api-free; se a DeepL
// disser que é o endereço errado (403), tenta o outro — assim funciona com qualquer tipo de chave.
async function deepl(env, textos) {
  const chave = env.DEEPL_KEY.trim();
  const FREE = 'https://api-free.deepl.com/v2/translate', PAGO = 'https://api.deepl.com/v2/translate';
  const corpo = JSON.stringify({
    text: textos,
    source_lang: 'PT', target_lang: 'EN-US',
    tag_handling: 'html'          // mantém imagens, links e formatação do post
  });
  const pedir = api => fetch(api, { method: 'POST', headers: { 'Authorization': 'DeepL-Auth-Key ' + chave, 'Content-Type': 'application/json' }, body: corpo });
  const primeiro = chave.endsWith(':fx') ? FREE : PAGO;
  let dl = await pedir(primeiro);
  if (dl.status === 403) dl = await pedir(primeiro === FREE ? PAGO : FREE);
  if (dl.status === 456) return { erro: 'cota de caracteres da DeepL acabou', cota: true };
  if (!dl.ok) return { erro: 'DeepL respondeu ' + dl.status };
  return { tr: ((await dl.json()).translations || []).map(x => x.text) };
}

function dadosDoPost(e) {
  const m = /post-(\d+)/.exec((e.id && e.id.$t) || '');
  return {
    id: m ? m[1] : '',
    editado: (e.updated && e.updated.$t) || '',
    titulo: (e.title && e.title.$t) || '',
    html: (e.content && e.content.$t) || (e.summary && e.summary.$t) || ''
  };
}

// Tradução de um post (usa a guardada, se houver). Devolve { out } ou { erro, status, cota }.
async function traduzir(env, p, soTitulo, guardar) {
  const kPost = `${p.id}:${p.editado}:post`, kTit = `${p.id}:${p.editado}:titulo`;
  const guardado = await env.TRAD.get(kPost, 'json');
  if (guardado) return { out: soTitulo ? { titulo: guardado.titulo } : guardado, jaTinha: true };
  if (soTitulo) {
    const t = await env.TRAD.get(kTit, 'json');
    if (t) return { out: t, jaTinha: true };
  }
  if (!soTitulo && p.html.length > MAX_HTML) return { erro: 'post grande demais para traduzir', status: 413 };
  const r = await deepl(env, soTitulo ? [p.titulo] : [p.titulo, p.html]);
  if (r.erro) return { erro: r.erro, status: 502, cota: r.cota };
  const out = soTitulo ? { titulo: r.tr[0] || p.titulo } : { titulo: r.tr[0] || p.titulo, html: r.tr[1] || p.html };
  await guardar(env.TRAD.put(soTitulo ? kTit : kPost, JSON.stringify(out)));
  return { out };
}

// Robô: traduz um lote de posts que ainda não têm tradução
async function lote(env) {
  const est = (await env.TRAD.get(K_ROBO, 'json')) || { indice: 1, traduzidos: 0, voltas: 0 };
  const agora = new Date().toISOString();
  // cota acabou: tenta de novo só uma vez por dia (caso você aumente o plano ou a cota volte)
  if (est.cotaAcabou && Date.now() - Date.parse(est.cotaAcabou) < 24 * 3600 * 1000) return est;
  delete est.cotaAcabou;

  const r = await fetch(`${BLOG}/feeds/posts/default?alt=json&orderby=published&max-results=${LOTE_POSTS}&start-index=${est.indice}`);
  if (!r.ok) { est.erro = 'Blogger respondeu ' + r.status; est.ultimaVez = agora; await env.TRAD.put(K_ROBO, JSON.stringify(est)); return est; }
  const feed = (await r.json()).feed || {};
  const entradas = feed.entry || [];
  est.totalPosts = +((feed.openSearch$totalResults && feed.openSearch$totalResults.$t) || est.totalPosts || 0);
  delete est.erro;

  let feitos = 0, vistos = 0;
  for (const e of entradas) {
    const p = dadosDoPost(e);
    if (!p.id) { est.indice++; vistos++; continue; }
    const res = await traduzir(env, p, false, x => x);
    if (res.cota) { est.cotaAcabou = agora; break; }          // para aqui; continua deste post depois
    est.indice++; vistos++;
    if (res.out && !res.jaTinha) { est.traduzidos++; feitos++; }
    if (res.erro) est.ultimoErro = `post ${p.id}: ${res.erro}`;
    if (feitos >= LOTE_TRAD) break;
  }
  // chegou ao fim do blog: recomeça do início (pega posts novos ou editados)
  if (!est.cotaAcabou && vistos === entradas.length && (entradas.length < LOTE_POSTS || est.indice > est.totalPosts)) {
    if (!est.terminouEm) est.terminouEm = agora;
    est.indice = 1; est.voltas++;
  }
  est.ultimaVez = agora; est.ultimoLote = feitos;
  await env.TRAD.put(K_ROBO, JSON.stringify(est));
  return est;
}

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGENS.test(origin) ? origin : BLOG,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return resposta({ erro: 'método' }, 405, cors);
    if (!env.DEEPL_KEY || !env.TRAD) return resposta({ erro: 'Worker sem DEEPL_KEY ou TRAD configurados' }, 500, cors);

    const url = new URL(req.url);
    // andamento do robô
    if (url.searchParams.get('status')) {
      const est = (await env.TRAD.get(K_ROBO, 'json')) || { aviso: 'o robô ainda não rodou' };
      return resposta(est, 200, cors);
    }
    // rodar um lote agora
    if (url.searchParams.get('robo')) return resposta(await lote(env), 200, cors);

    const id = (url.searchParams.get('post') || '').replace(/\D/g, '');
    const soTitulo = url.searchParams.get('so') === 'titulo';
    if (!id) return resposta({ erro: 'faltou ?post=' }, 400, cors);

    // o post como está agora no Blogger
    const r = await fetch(`${BLOG}/feeds/posts/default/${id}?alt=json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return resposta({ erro: 'post não encontrado' }, 404, cors);
    const p = dadosDoPost((await r.json()).entry || {});
    p.id = id;
    const res = await traduzir(env, p, soTitulo, x => ctx.waitUntil(x));
    if (res.erro) return resposta({ erro: res.erro }, res.status || 502, cors);
    return resposta(limpo(res.out), 200, cors);
  },

  // Cron Trigger: o robô roda sozinho no horário configurado
  async scheduled(event, env, ctx) {
    if (!env.DEEPL_KEY || !env.TRAD) return;
    ctx.waitUntil(lote(env));
  }
};
