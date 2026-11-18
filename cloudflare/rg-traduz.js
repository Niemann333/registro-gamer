/* Registro Gamer — tradução das postagens (Cloudflare Worker "rg-traduz")
 *
 * GET /?post=<id do post>            → { titulo, html }   (post inteiro em inglês)
 * GET /?post=<id do post>&so=titulo  → { titulo }         (só o título, para listas)
 *
 * O Worker não aceita texto de fora: ele mesmo busca o post no Blogger pelo id e traduz.
 * Assim ninguém consegue usar a sua cota da DeepL para traduzir outras coisas.
 * Cada tradução fica guardada no KV (TRAD) com a data da última edição do post:
 * o post só é traduzido de novo se você editar ele.
 *
 * Configuração no painel do Cloudflare (Worker rg-traduz → Settings):
 *   • Variables and Secrets → Secret  DEEPL_KEY = sua chave da API da DeepL
 *   • Bindings → KV namespace          TRAD      = rg-traducoes
 */
const BLOG = 'https://lucniemanngames.blogspot.com';
const ORIGENS = /^https:\/\/(lucniemanngames\.blogspot\.com|www\.lucniemanngames\.blogspot\.com|niemann333\.github\.io)$/;
const MAX_HTML = 120000;   // a DeepL aceita até ~128 KB por pedido

function resposta(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
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
    const id = (url.searchParams.get('post') || '').replace(/\D/g, '');
    const soTitulo = url.searchParams.get('so') === 'titulo';
    if (!id) return resposta({ erro: 'faltou ?post=' }, 400, cors);

    // o post como está agora no Blogger
    const r = await fetch(`${BLOG}/feeds/posts/default/${id}?alt=json`, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!r.ok) return resposta({ erro: 'post não encontrado' }, 404, cors);
    const e = (await r.json()).entry || {};
    const editado = (e.updated && e.updated.$t) || '';
    const titulo = (e.title && e.title.$t) || '';
    const html = (e.content && e.content.$t) || (e.summary && e.summary.$t) || '';

    const kPost = `${id}:${editado}:post`, kTit = `${id}:${editado}:titulo`;
    const guardado = await env.TRAD.get(kPost, 'json');
    if (guardado) return resposta(soTitulo ? { titulo: guardado.titulo } : guardado, 200, cors);
    if (soTitulo) {
      const t = await env.TRAD.get(kTit, 'json');
      if (t) return resposta(t, 200, cors);
    }
    if (!soTitulo && html.length > MAX_HTML) return resposta({ erro: 'post grande demais para traduzir' }, 413, cors);

    // DeepL: chave do plano gratuito termina em ":fx"
    const api = env.DEEPL_KEY.trim().endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
    const dl = await fetch(api, {
      method: 'POST',
      headers: { 'Authorization': 'DeepL-Auth-Key ' + env.DEEPL_KEY.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: soTitulo ? [titulo] : [titulo, html],
        source_lang: 'PT', target_lang: 'EN-US',
        tag_handling: 'html'          // mantém imagens, links e formatação do post
      })
    });
    if (!dl.ok) return resposta({ erro: 'DeepL respondeu ' + dl.status }, 502, cors);
    const tr = ((await dl.json()).translations || []).map(x => x.text);
    const out = soTitulo ? { titulo: tr[0] || titulo } : { titulo: tr[0] || titulo, html: tr[1] || html };
    ctx.waitUntil(env.TRAD.put(soTitulo ? kTit : kPost, JSON.stringify(out)));
    return resposta(out, 200, cors);
  }
};
