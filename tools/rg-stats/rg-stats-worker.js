// rg-stats — contador de visitas do blog Registro Gamer e do Chiptune Studio (Cloudflare Worker + D1)
//
// Como instalar (painel do Cloudflare):
//  1. Workers & Pages → D1 → Criar banco "rg-stats".
//  2. Workers & Pages → Criar → Worker → nome "rg-stats" → Implantar → Editar código: cole este arquivo → Implantar.
//  3. No Worker: Configurações → Vinculações → Adicionar → Banco de dados D1 → nome da variável "DB" → banco "rg-stats".
//  4. Configurações → Variáveis e segredos → Adicionar → tipo "Segredo" → nome "ADMIN_KEY" → a senha do painel.
//  5. Painel: https://rg-stats.<sua-conta>.workers.dev/painel
//
// O que grava por página vista: hora, site (blog/studio), página, de onde veio, IP, país/região/cidade e provedor
// (informados pelo Cloudflare), navegador/aparelho, idioma, tamanho da tela e quanto tempo a página ficou aberta
// e visível (o navegador avisa a cada 30 s enquanto a aba está à vista). Robôs conhecidos são ignorados.
// Visitas com mais de 400 dias são apagadas sozinhas.

const ORIGENS = [/^https:\/\/[a-z0-9-]+\.blogspot\.com$/, /^https:\/\/[a-z0-9-]+\.blogspot\.com\.br$/, /^https:\/\/lucniemann\.github\.io$/, /^https:\/\/niemann333\.github\.io$/];
const ROBO = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|httpclient|facebookexternalhit|embedly|whatsapp|telegram/i;
const RETER_DIAS = 400;

const SQL_INIT = [
  `CREATE TABLE IF NOT EXISTS visitas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tok TEXT, site TEXT, pagina TEXT, ref TEXT, sid TEXT,
    ip TEXT, pais TEXT, regiao TEXT, cidade TEXT, provedor TEXT,
    ua TEXT, idioma TEXT, tela TEXT, embutido INTEGER,
    inicio INTEGER, ultimo INTEGER, dur INTEGER DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS visitas_inicio ON visitas(inicio)`,
  `CREATE INDEX IF NOT EXISTS visitas_site ON visitas(site, inicio)`,
  `CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visita INTEGER, site TEXT, ip TEXT, gadget TEXT, acao TEXT, detalhe TEXT, quando INTEGER)`,
  `CREATE INDEX IF NOT EXISTS eventos_quando ON eventos(quando)`,
  `CREATE INDEX IF NOT EXISTS eventos_gadget ON eventos(gadget, quando)`
];
let iniciado = false;
async function init(env) {
  if (iniciado) return;
  for (const q of SQL_INIT) await env.DB.prepare(q).run();
  iniciado = true;
}

function cors(req) {
  const o = req.headers.get('Origin') || '';
  const ok = ORIGENS.some(r => r.test(o));
  return ok ? { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin' } : {};
}
function json(obj, extra = {}, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
const corta = (s, n) => (s == null ? '' : String(s)).slice(0, n);

// ---------- sessão do painel (cookie assinado com a senha) ----------
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function logado(req, env) {
  if (!env.ADMIN_KEY) return false;
  const c = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)rgst=([0-9]+)\.([0-9a-f]+)/);
  if (!c) return false;
  if (Date.now() > Number(c[1])) return false;
  return (await hmac(env.ADMIN_KEY, 'painel' + c[1])) === c[2];
}
async function cookieSessao(env) {
  const ate = Date.now() + 30 * 864e5;
  return `rgst=${ate}.${await hmac(env.ADMIN_KEY, 'painel' + ate)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax`;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const h = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...h, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    if (!env.DB) return new Response('Falta vincular o banco D1 com o nome DB.', { status: 500 });
    await init(env);

    // ---------- página vista ----------
    if (url.pathname === '/v' && req.method === 'POST') {
      if (!h['Access-Control-Allow-Origin']) return json({ ok: false }, {}, 403);
      const ua = req.headers.get('User-Agent') || '';
      if (ROBO.test(ua)) return json({ ok: false }, h);
      let b = {};
      try { b = JSON.parse(await req.text()); } catch (e) {}
      const cf = req.cf || {};
      const agora = Date.now();
      const tok = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      const r = await env.DB.prepare(`INSERT INTO visitas (tok,site,pagina,ref,sid,ip,pais,regiao,cidade,provedor,ua,idioma,tela,embutido,inicio,ultimo,dur)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).bind(
        tok, corta(b.s || 'blog', 16), corta(b.p, 300), corta(b.r, 300), corta(b.sid, 40),
        req.headers.get('CF-Connecting-IP') || '', cf.country || '', cf.region || '', cf.city || '', corta(cf.asOrganization || '', 80),
        corta(ua, 300), corta(b.l, 20), corta(b.w, 20), b.e ? 1 : 0, agora, agora).run();
      // limpeza ocasional
      if (Math.random() < 0.01) ctx.waitUntil(env.DB.prepare('DELETE FROM visitas WHERE inicio < ?').bind(agora - RETER_DIAS * 864e5).run());
      return json({ ok: true, id: r.meta.last_row_id, k: tok }, h);
    }
    // ---------- o que a pessoa fez nos gadgets (lote de eventos da página) ----------
    if (url.pathname === '/e' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(await req.text()); } catch (e) {}
      if (!b.id || !b.k || !Array.isArray(b.ev)) return json({ ok: false }, h);
      const v = await env.DB.prepare('SELECT id, site, ip FROM visitas WHERE id=? AND tok=? AND inicio > ?')
        .bind(Number(b.id), String(b.k), Date.now() - 12 * 3600e3).first();
      if (!v) return json({ ok: false }, h);
      const agora = Date.now();
      const st = env.DB.prepare('INSERT INTO eventos (visita,site,ip,gadget,acao,detalhe,quando) VALUES (?,?,?,?,?,?,?)');
      const lote = b.ev.slice(0, 40).map(e => st.bind(v.id, v.site, v.ip, corta(e[0], 24), corta(e[1], 40), corta(e[2], 200),
        agora - Math.max(0, Math.min(600000, Number(e[3]) || 0))));
      if (lote.length) await env.DB.batch(lote);
      if (Math.random() < 0.01) ctx.waitUntil(env.DB.prepare('DELETE FROM eventos WHERE quando < ?').bind(agora - RETER_DIAS * 864e5).run());
      return json({ ok: true }, h);
    }
    // ---------- ainda aberta (a cada 30 s, e ao sair) ----------
    if (url.pathname === '/p' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(await req.text()); } catch (e) {}
      const add = Math.max(0, Math.min(60000, Number(b.t) || 0)); // tempo visível desde o último aviso
      if (b.id && b.k) {
        await env.DB.prepare('UPDATE visitas SET ultimo=?, dur=dur+? WHERE id=? AND tok=? AND inicio > ?')
          .bind(Date.now(), add, Number(b.id), String(b.k), Date.now() - 12 * 3600e3).run();
      }
      return json({ ok: true }, h);
    }

    // ---------- painel ----------
    if (url.pathname === '/painel' && req.method === 'POST') {
      const f = await req.formData();
      if (env.ADMIN_KEY && f.get('senha') === env.ADMIN_KEY) {
        return new Response(null, { status: 303, headers: { 'Location': '/painel', 'Set-Cookie': await cookieSessao(env) } });
      }
      return new Response(paginaLogin('Senha errada.'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname === '/painel') {
      if (!env.ADMIN_KEY) return new Response('Falta criar o segredo ADMIN_KEY no Worker.', { status: 500 });
      if (!(await logado(req, env))) return new Response(paginaLogin(''), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return new Response(PAINEL, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/sair') {
      return new Response(null, { status: 303, headers: { 'Location': '/painel', 'Set-Cookie': 'rgst=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } });
    }
    if (url.pathname === '/api/dados') {
      if (!(await logado(req, env))) return json({ erro: 'login' }, {}, 401);
      return json(await dados(env, url));
    }
    return new Response('rg-stats', { headers: { 'Content-Type': 'text/plain' } });
  }
};

// ---------- números para o painel ----------
async function dados(env, url) {
  const dias = Math.max(1, Math.min(RETER_DIAS, Number(url.searchParams.get('dias')) || 30));
  const site = url.searchParams.get('site') || '';
  const tz = Number(url.searchParams.get('tz')) || 0; // minutos a somar ao UTC (Brasília = -180)
  const desde = Date.now() - dias * 864e5;
  const ws = site ? ' AND site=?' : '';
  const arg = site ? [desde, site] : [desde];
  const dia = `strftime('%Y-%m-%d', (inicio/1000) + (${tz})*60, 'unixepoch')`;
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then(r => r.results);
  const gadget = url.searchParams.get('gadget') || '';
  const wg = (site ? ' AND site=?' : '') + (gadget ? ' AND gadget=?' : '');
  const argE = [desde].concat(site ? [site] : [], gadget ? [gadget] : []);
  const diaE = `strftime('%Y-%m-%d', (quando/1000) + (${tz})*60, 'unixepoch')`;
  const [gadgets, acoes, itens, evDia, evRec] = await Promise.all([
    q(`SELECT gadget, COUNT(*) AS n, COUNT(DISTINCT ip) AS pessoas, COUNT(DISTINCT visita) AS visitas FROM eventos
       WHERE quando>=?${ws} GROUP BY gadget ORDER BY n DESC`, ...arg),
    q(`SELECT gadget, acao, COUNT(*) AS n, COUNT(DISTINCT ip) AS pessoas FROM eventos WHERE quando>=?${wg}
       GROUP BY gadget, acao ORDER BY n DESC LIMIT 40`, ...argE),
    q(`SELECT gadget, acao, detalhe, COUNT(*) AS n, COUNT(DISTINCT ip) AS pessoas FROM eventos WHERE quando>=?${wg} AND detalhe<>''
       GROUP BY gadget, acao, detalhe ORDER BY n DESC LIMIT 60`, ...argE),
    q(`SELECT ${diaE} AS dia, gadget, COUNT(*) AS n FROM eventos WHERE quando>=?${wg} GROUP BY dia, gadget ORDER BY dia`, ...argE),
    q(`SELECT e.quando, e.site, e.gadget, e.acao, e.detalhe, e.ip, v.cidade, v.pais FROM eventos e LEFT JOIN visitas v ON v.id=e.visita
       WHERE e.quando>=?${wg.replace(/ AND (site|gadget)=/g, ' AND e.$1=')} ORDER BY e.id DESC LIMIT 300`, ...argE)
  ]);
  const [porDia, total, paginas, paises, origens, aparelhos, recentes, online, porHora] = await Promise.all([
    q(`SELECT ${dia} AS dia, COUNT(*) AS vistas, COUNT(DISTINCT ip) AS pessoas, CAST(AVG(dur) AS INTEGER) AS tempo
       FROM visitas WHERE inicio>=?${ws} GROUP BY dia ORDER BY dia`, ...arg),
    q(`SELECT COUNT(*) AS vistas, COUNT(DISTINCT ip) AS pessoas, COUNT(DISTINCT sid) AS sessoes, CAST(AVG(dur) AS INTEGER) AS tempo,
       SUM(dur) AS tempoTotal FROM visitas WHERE inicio>=?${ws}`, ...arg),
    q(`SELECT site, pagina, COUNT(*) AS n, CAST(AVG(dur) AS INTEGER) AS tempo FROM visitas WHERE inicio>=?${ws}
       GROUP BY site, pagina ORDER BY n DESC LIMIT 30`, ...arg),
    q(`SELECT pais, COUNT(*) AS n, COUNT(DISTINCT ip) AS pessoas FROM visitas WHERE inicio>=?${ws} GROUP BY pais ORDER BY n DESC LIMIT 20`, ...arg),
    q(`SELECT ref, COUNT(*) AS n FROM visitas WHERE inicio>=?${ws} AND ref<>'' GROUP BY ref ORDER BY n DESC LIMIT 20`, ...arg),
    q(`SELECT ua FROM visitas WHERE inicio>=?${ws} ORDER BY id DESC LIMIT 2000`, ...arg),
    q(`SELECT id, site, pagina, ref, ip, pais, regiao, cidade, provedor, ua, idioma, tela, embutido, inicio, ultimo, dur
       FROM visitas WHERE inicio>=?${ws} ORDER BY id DESC LIMIT 300`, ...arg),
    q(`SELECT COUNT(DISTINCT ip) AS n FROM visitas WHERE ultimo>=?${ws}`, ...(site ? [Date.now() - 75e3, site] : [Date.now() - 75e3])),
    q(`SELECT CAST(strftime('%H', (inicio/1000) + (${tz})*60, 'unixepoch') AS INTEGER) AS hora, COUNT(*) AS n
       FROM visitas WHERE inicio>=?${ws} GROUP BY hora`, ...arg)
  ]);
  const ap = {};
  for (const r of aparelhos) { const k = aparelho(r.ua); ap[k] = (ap[k] || 0) + 1; }
  return { dias, site, gadget, porDia, total: total[0], paginas, paises, origens, aparelhos: ap, recentes, online: online[0].n, porHora,
    gadgets, acoes, itens, evDia, evRec };
}
function aparelho(ua) {
  ua = ua || '';
  const so = /Android/.test(ua) ? (/TV|AFT|BRAVIA|SMART-TV/i.test(ua) ? 'Android TV' : 'Android') : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'outro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'outro';
  return so + ' · ' + nav;
}

function paginaLogin(msg) {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visitas · Registro Gamer</title><style>body{background:#0b0b10;color:#e8e6ff;font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}
form{background:#15141f;padding:28px;border-radius:12px;border:1px solid #2c2a44;min-width:280px}h1{font-size:18px;margin:0 0 16px}
input,button{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #3a3760;background:#0b0b10;color:#fff;font-size:15px}
button{margin-top:10px;background:#7c5cff;border:0;cursor:pointer;font-weight:600}.e{color:#ff7a8a;font-size:14px;margin-top:8px}</style>
<form method="post" action="/painel"><h1>Painel de visitas</h1><input type="password" name="senha" placeholder="Senha" autofocus>
<button>Entrar</button>${msg ? '<div class="e">' + msg + '</div>' : ''}</form></html>`;
}

const PAINEL = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visitas · Registro Gamer</title>
<style>
:root{--bg:#0b0b10;--card:#15141f;--line:#2c2a44;--tx:#e8e6ff;--mut:#9a96c0;--a:#7c5cff;--b:#3ad0ff;--c:#35e08a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px system-ui,sans-serif}
header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
header h1{font-size:17px;margin:0 12px 0 0}select,button,a.bt{background:var(--card);color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:14px;text-decoration:none;cursor:pointer}
main{padding:16px;display:grid;gap:14px;grid-template-columns:repeat(12,1fr)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}
.k{grid-column:span 3}.w{grid-column:span 12}.h{grid-column:span 6}.t{grid-column:span 4}
@media(max-width:900px){.k{grid-column:span 6}.h,.t{grid-column:span 12}}
.k b{display:block;font-size:26px;margin-top:4px}.k span{color:var(--mut)}
h2{font-size:14px;margin:0 0 10px;color:var(--mut);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:600}td.n{text-align:right;white-space:nowrap}.sc{max-height:520px;overflow:auto}
.bar{height:8px;background:var(--a);border-radius:4px}.leg{display:flex;gap:14px;color:var(--mut);font-size:12px;margin-top:6px}
.leg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
svg text{fill:var(--mut);font-size:10px}.tip{position:fixed;pointer-events:none;background:#000c;border:1px solid var(--line);padding:6px 8px;border-radius:6px;font-size:12px;display:none;z-index:9}
.on{color:var(--c)}
</style></head><body>
<header><h1>📈 Visitas · Registro Gamer</h1>
<select id="site"><option value="">Blog + Studio</option><option value="blog">Só o blog</option><option value="studio">Só o Chiptune Studio</option></select>
<select id="dias"><option value="1">Hoje (24 h)</option><option value="7">7 dias</option><option value="30" selected>30 dias</option><option value="90">90 dias</option><option value="365">1 ano</option></select>
<button id="atu">Atualizar</button><span id="onl" class="on"></span><span style="flex:1"></span><a class="bt" href="/sair">Sair</a></header>
<main>
<div class="card k"><span>Páginas vistas</span><b id="kv">–</b></div>
<div class="card k"><span>Pessoas (IPs diferentes)</span><b id="kp">–</b></div>
<div class="card k"><span>Visitas (sessões)</span><b id="ks">–</b></div>
<div class="card k"><span>Tempo médio por página</span><b id="kt">–</b></div>
<div class="card w"><h2>Movimento por dia</h2><div id="gDia"></div>
<div class="leg"><span><i style="background:var(--a)"></i>páginas vistas</span><span><i style="background:var(--b)"></i>pessoas</span><span><i style="background:var(--c)"></i>tempo médio (min)</span></div></div>
<div class="card h"><h2>Horário das visitas</h2><div id="gHora"></div></div>
<div class="card h"><h2>Aparelhos</h2><div id="tAp"></div></div>
<div class="card t"><h2>Páginas mais vistas</h2><div class="sc" id="tPag"></div></div>
<div class="card t"><h2>Países</h2><div class="sc" id="tPais"></div></div>
<div class="card t"><h2>De onde vieram</h2><div class="sc" id="tRef"></div></div>
<div class="card w"><h2>Gadgets: uso por dia <select id="gad" style="margin-left:10px;font-size:12px;padding:3px 6px"><option value="">todos os gadgets</option></select></h2><div id="gEv"></div><div class="leg" id="legEv"></div></div>
<div class="card t"><h2>Gadgets</h2><div class="sc" id="tGad"></div></div>
<div class="card t"><h2>O que fizeram</h2><div class="sc" id="tAc"></div></div>
<div class="card t"><h2>Mais usados (músicas, jogos, buscas…)</h2><div class="sc" id="tIt"></div></div>
<div class="card w"><h2>Últimas ações nos gadgets</h2><div class="sc" id="tEv"></div></div>
<div class="card w"><h2>Últimas visitas</h2><div class="sc" id="tRec"></div></div>
</main><div class="tip" id="tip"></div>
<script>
const $=id=>document.getElementById(id);const TZ=-new Date().getTimezoneOffset();
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tempo=ms=>{ms=Number(ms)||0;const s=Math.round(ms/1000);if(s<60)return s+' s';const m=Math.floor(s/60);if(m<60)return m+' min '+(s%60)+' s';return Math.floor(m/60)+' h '+(m%60)+' min'};
const num=n=>Number(n||0).toLocaleString('pt-BR');
const flag=c=>c&&c.length===2?String.fromCodePoint(...[...c.toUpperCase()].map(x=>127397+x.charCodeAt(0))):'';
function tip(e,t){const d=$('tip');if(!t){d.style.display='none';return}d.innerHTML=t;d.style.display='block';d.style.left=(e.clientX+12)+'px';d.style.top=(e.clientY+12)+'px'}
function dias(n){const out=[];const d=new Date();for(let i=n-1;i>=0;i--){const x=new Date(d.getTime()-i*864e5);out.push(x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'))}return out}
function grafDia(rows,n){
  const m={};rows.forEach(r=>m[r.dia]=r);const ds=dias(Math.max(n,1));
  const W=Math.max(600,$('gDia').clientWidth),H=220,P=34,bw=(W-P*2)/ds.length;
  const mx=Math.max(4,...ds.map(d=>(m[d]||{}).vistas||0));const mt=Math.max(1,...ds.map(d=>((m[d]||{}).tempo||0)/60000));
  let s='<svg width="'+W+'" height="'+H+'">';
  for(let i=0;i<=4;i++){const y=H-P-(H-P*2)*i/4;s+='<line x1="'+P+'" x2="'+(W-P)+'" y1="'+y+'" y2="'+y+'" stroke="#2c2a44"/><text x="'+(P-4)+'" y="'+(y+3)+'" text-anchor="end">'+Math.round(mx*i/4)+'</text>'}
  let lp='',lt='';
  ds.forEach((d,i)=>{const r=m[d]||{vistas:0,pessoas:0,tempo:0};const x=P+i*bw;const hv=(H-P*2)*r.vistas/mx;
    s+='<rect x="'+(x+bw*0.15)+'" y="'+(H-P-hv)+'" width="'+Math.max(1,bw*0.7)+'" height="'+hv+'" rx="2" fill="#7c5cff" data-t="'+esc(d.split('-').reverse().join('/')+'<br>'+r.vistas+' páginas vistas<br>'+r.pessoas+' pessoas<br>tempo médio '+tempo(r.tempo))+'"/>';
    const cx=x+bw/2;lp+=(i?'L':'M')+cx+','+(H-P-(H-P*2)*r.pessoas/mx);lt+=(i?'L':'M')+cx+','+(H-P-(H-P*2)*(r.tempo/60000)/mt);
    if(ds.length<=31||i%Math.ceil(ds.length/20)===0)s+='<text x="'+cx+'" y="'+(H-P+14)+'" text-anchor="middle">'+d.slice(8)+'/'+d.slice(5,7)+'</text>'});
  s+='<path d="'+lp+'" fill="none" stroke="#3ad0ff" stroke-width="2"/><path d="'+lt+'" fill="none" stroke="#35e08a" stroke-width="1.5" stroke-dasharray="4 3"/></svg>';
  $('gDia').innerHTML=s;
  $('gDia').querySelectorAll('rect').forEach(r=>{r.onmousemove=e=>tip(e,r.dataset.t);r.onmouseleave=e=>tip(e,'')});
}
function grafHora(rows){const m={};rows.forEach(r=>m[r.hora]=r.n);const W=Math.max(300,$('gHora').clientWidth),H=150,P=24,bw=(W-P*2)/24;const mx=Math.max(1,...Object.values(m));
  let s='<svg width="'+W+'" height="'+H+'">';for(let h=0;h<24;h++){const v=m[h]||0,hh=(H-P*2)*v/mx;s+='<rect x="'+(P+h*bw+1)+'" y="'+(H-P-hh)+'" width="'+(bw-2)+'" height="'+hh+'" fill="#3ad0ff" rx="2" data-t="'+h+'h: '+v+'"/>';if(h%3===0)s+='<text x="'+(P+h*bw+bw/2)+'" y="'+(H-P+13)+'" text-anchor="middle">'+h+'h</text>'}
  $('gHora').innerHTML=s+'</svg>';$('gHora').querySelectorAll('rect').forEach(r=>{r.onmousemove=e=>tip(e,r.dataset.t);r.onmouseleave=e=>tip(e,'')})}
function tabela(el,cab,linhas){$(el).innerHTML='<table><tr>'+cab.map(c=>'<th>'+c+'</th>').join('')+'</tr>'+linhas.map(l=>'<tr>'+l.join('')+'</tr>').join('')+'</table>'}
function barras(el,obj){const e=Object.entries(obj).sort((a,b)=>b[1]-a[1]);const mx=Math.max(1,...e.map(x=>x[1]));tabela(el,['',''],e.map(([k,v])=>['<td>'+esc(k)+'<div class="bar" style="width:'+(100*v/mx)+'%"></div></td>','<td class="n">'+num(v)+'</td>']))}
const COR=['#7c5cff','#3ad0ff','#35e08a','#ffb347','#ff6b9a','#c38bff','#66e0d0','#e6e65c','#ff8a5c','#8ab4ff','#b0b0b0'];
const GNOME={player:'🎵 Chiptune Player',estante:'🎮 Estante',feed:'📰 Feed',arquivo:'🗂 Arquivo',filtragem:'🏷 Filtragem',busca:'🔎 Busca',studio:'🎹 Studio',tracker:'🎛 Tracker',menu:'📱 Menu (celular)',blog:'Blog (outros)'};
const gn=g=>GNOME[g]||g;
function grafEv(rows,n){
  const ds=dias(Math.max(n,1)),gs=[...new Set(rows.map(r=>r.gadget))];const m={};rows.forEach(r=>{(m[r.dia]=m[r.dia]||{})[r.gadget]=r.n});
  const W=Math.max(600,$('gEv').clientWidth),H=200,P=34,bw=(W-P*2)/ds.length;
  const mx=Math.max(4,...ds.map(d=>gs.reduce((a,g)=>a+((m[d]||{})[g]||0),0)));
  let s='<svg width="'+W+'" height="'+H+'">';
  for(let i=0;i<=4;i++){const y=H-P-(H-P*2)*i/4;s+='<line x1="'+P+'" x2="'+(W-P)+'" y1="'+y+'" y2="'+y+'" stroke="#2c2a44"/><text x="'+(P-4)+'" y="'+(y+3)+'" text-anchor="end">'+Math.round(mx*i/4)+'</text>'}
  ds.forEach((d,i)=>{let y=H-P;const x=P+i*bw;gs.forEach((g,k)=>{const v=(m[d]||{})[g]||0;if(!v)return;const hh=(H-P*2)*v/mx;y-=hh;
    s+='<rect x="'+(x+bw*0.15)+'" y="'+y+'" width="'+Math.max(1,bw*0.7)+'" height="'+hh+'" fill="'+COR[k%COR.length]+'" data-t="'+esc(d.split('-').reverse().join('/')+'<br>'+gn(g)+': '+v)+'"/>'});
    if(ds.length<=31||i%Math.ceil(ds.length/20)===0)s+='<text x="'+(x+bw/2)+'" y="'+(H-P+14)+'" text-anchor="middle">'+d.slice(8)+'/'+d.slice(5,7)+'</text>'});
  $('gEv').innerHTML=s+'</svg>';$('legEv').innerHTML=gs.map((g,k)=>'<span><i style="background:'+COR[k%COR.length]+'"></i>'+esc(gn(g))+'</span>').join('');
  $('gEv').querySelectorAll('rect').forEach(r=>{r.onmousemove=e=>tip(e,r.dataset.t);r.onmouseleave=e=>tip(e,'')});
}
function dur(r){return r.dur>0?tempo(r.dur):'<span style="color:var(--mut)">–</span>'}
async function carregar(){
  const r=await fetch('/api/dados?dias='+$('dias').value+'&site='+$('site').value+'&gadget='+encodeURIComponent($('gad').value)+'&tz='+TZ,{credentials:'same-origin'});
  if(r.status===401){location.reload();return}const d=await r.json();
  $('kv').textContent=num(d.total.vistas);$('kp').textContent=num(d.total.pessoas);$('ks').textContent=num(d.total.sessoes);$('kt').textContent=tempo(d.total.tempo);
  $('onl').textContent='● '+d.online+' online agora';
  const gsel=$('gad'),gv=gsel.value;gsel.innerHTML='<option value="">todos os gadgets</option>'+d.gadgets.map(x=>'<option value="'+esc(x.gadget)+'">'+esc(gn(x.gadget))+'</option>').join('');gsel.value=gv;
  grafEv(d.evDia,d.dias);
  tabela('tGad',['Gadget','Ações','Pessoas','Visitas'],d.gadgets.map(x=>['<td>'+esc(gn(x.gadget))+'</td>','<td class="n">'+num(x.n)+'</td>','<td class="n">'+num(x.pessoas)+'</td>','<td class="n">'+num(x.visitas)+'</td>']));
  tabela('tAc',['Gadget','Ação','Vezes','Pessoas'],d.acoes.map(x=>['<td>'+esc(gn(x.gadget))+'</td>','<td>'+esc(x.acao)+'</td>','<td class="n">'+num(x.n)+'</td>','<td class="n">'+num(x.pessoas)+'</td>']));
  tabela('tIt',['Gadget · ação','Item','Vezes'],d.itens.map(x=>['<td>'+esc(gn(x.gadget))+'<br><span style="color:var(--mut)">'+esc(x.acao)+'</span></td>','<td>'+esc(x.detalhe)+'</td>','<td class="n">'+num(x.n)+'</td>']));
  tabela('tEv',['Quando','Gadget','Ação','Item','IP','Local'],d.evRec.map(x=>['<td class="n">'+new Date(x.quando).toLocaleString('pt-BR')+'</td>','<td>'+esc(gn(x.gadget))+'</td>','<td>'+esc(x.acao)+'</td>','<td>'+esc(x.detalhe)+'</td>','<td>'+esc(x.ip)+'</td>','<td>'+flag(x.pais)+' '+esc([x.cidade,x.pais].filter(Boolean).join(', '))+'</td>']));
  grafDia(d.porDia,d.dias);grafHora(d.porHora);barras('tAp',d.aparelhos);
  tabela('tPag',['Página','Vistas','Tempo'],d.paginas.map(p=>['<td>'+(p.site==='studio'?'🎹 ':'')+esc(decodeURIComponent(p.pagina||'/'))+'</td>','<td class="n">'+num(p.n)+'</td>','<td class="n">'+tempo(p.tempo)+'</td>']));
  tabela('tPais',['País','Vistas','Pessoas'],d.paises.map(p=>['<td>'+flag(p.pais)+' '+esc(p.pais||'?')+'</td>','<td class="n">'+num(p.n)+'</td>','<td class="n">'+num(p.pessoas)+'</td>']));
  tabela('tRef',['Origem','Vistas'],d.origens.map(p=>['<td>'+esc(p.ref)+'</td>','<td class="n">'+num(p.n)+'</td>']));
  tabela('tRec',['Quando','Site','Página','IP','Local','Provedor','Aparelho','Tempo'],d.recentes.map(v=>{const on=Date.now()-v.ultimo<75e3;
    return ['<td class="n">'+new Date(v.inicio).toLocaleString('pt-BR')+(on?' <span class="on">●</span>':'')+'</td>','<td>'+(v.site==='studio'?'🎹 Studio':'Blog')+(v.embutido?' (no blog)':'')+'</td>',
    '<td>'+esc(decodeURIComponent(v.pagina||'/'))+(v.ref?'<br><span style="color:var(--mut)">de '+esc(v.ref)+'</span>':'')+'</td>','<td>'+esc(v.ip)+'</td>',
    '<td>'+flag(v.pais)+' '+esc([v.cidade,v.regiao,v.pais].filter(Boolean).join(', '))+'</td>','<td>'+esc(v.provedor)+'</td>',
    '<td title="'+esc(v.ua)+'">'+esc((v.ua||'').match(/Android|iPhone|iPad|Windows|Mac OS|Linux/)?.[0]||'?')+(v.tela?' · '+esc(v.tela):'')+'</td>','<td class="n">'+dur(v)+'</td>']}));
}
$('atu').onclick=carregar;$('site').onchange=carregar;$('gad').onchange=carregar;$('dias').onchange=carregar;carregar();setInterval(carregar,60000);
</script></body></html>`;
