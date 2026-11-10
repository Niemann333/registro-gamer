package com.niemann333.registrogamer.tv;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Registro Gamer para Android TV / Google TV.
 * Abre o blog em tela cheia (versão de computador), sem barra de endereço,
 * e liga os botões de mídia do controle remoto ao player de chiptune.
 */
public class MainActivity extends Activity {

    private static final String BLOG = "https://lucniemanngames.blogspot.com/";
    private static final String HOST = "lucniemanngames.blogspot.com";

    // O blog no modo computador (o mesmo que o "modo desktop" do navegador da TV).
    private static final String UA_DESKTOP =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    // Injetado em cada página: guarda os comandos de mídia que o player registra
    // (play, pausa, próxima, anterior) para o controle remoto poder chamá-los.
    // Se o WebView não tiver a Media Session, cria uma versão simples só para isso.
    private static final String JS_PONTE =
            "(function(){if(window.__rgTV)return;window.__rgTV={h:{}};"
            + "try{if(!('mediaSession' in navigator)){"
            + "Object.defineProperty(navigator,'mediaSession',{value:{metadata:null,playbackState:'none',setActionHandler:function(){}},configurable:true});}"
            + "if(!window.MediaMetadata){window.MediaMetadata=function(o){for(var k in o)this[k]=o[k];};}"
            + "var ms=navigator.mediaSession,orig=ms.setActionHandler;"
            + "ms.setActionHandler=function(a,f){window.__rgTV.h[a]=f;try{return orig.call(ms,a,f);}catch(e){}};"
            + "}catch(e){}})();";

    private WebView web;
    private TextView aviso;
    private TextView selo;          // aviso rápido do modo (cursor / setas)
    private Cursor cursor;
    private boolean modoCursor = true;
    private long ultimoVoltar = 0;
    private KeyEvent okApertado = null;   // OK guardado até saber se é clique ou "segurar"
    private boolean okTrocouModo = false;
    private static final long SEGURAR_MS = 650;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.BLACK);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        raiz.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        cursor = new Cursor(this, web);
        raiz.addView(cursor, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        selo = new TextView(this);
        selo.setTextColor(Color.WHITE);
        selo.setTextSize(16);
        selo.setBackgroundColor(0xDD1B0B33);
        selo.setPadding(28, 14, 28, 14);
        selo.setVisibility(View.GONE);
        FrameLayout.LayoutParams lpSelo = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.END);
        lpSelo.setMargins(0, 0, 40, 40);
        raiz.addView(selo, lpSelo);

        aviso = new TextView(this);
        aviso.setTextColor(Color.WHITE);
        aviso.setTextSize(22);
        aviso.setGravity(Gravity.CENTER);
        aviso.setBackgroundColor(0xEE0A0A12);
        aviso.setPadding(48, 48, 48, 48);
        aviso.setVisibility(View.GONE);
        raiz.addView(aviso, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(raiz);
        telaCheia();
        configurar();

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(BLOG);
        web.requestFocus();
        mostrarSelo("Modo cursor: setas movem a seta, OK clica.  (Segure OK para trocar)", 5000);
    }

    private void configurar() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // música sem precisar tocar na tela
        s.setUserAgentString(UA_DESKTOP);
        s.setUseWideViewPort(true);                       // layout de computador...
        s.setLoadWithOverviewMode(true);                  // ...reduzido para caber na TV
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                String sch = u.getScheme();
                if ("http".equals(sch) || "https".equals(sch)) return false;   // tudo da web abre aqui dentro
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* sem app para isso */ }
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(JS_PONTE, null);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    mostrarAviso("Sem conexão com o blog.\n\nConfira a internet da TV e aperte OK para tentar de novo.");
                }
            }
        });
    }

    private void mostrarAviso(String txt) {
        aviso.setText(txt);
        aviso.setVisibility(View.VISIBLE);
    }

    private void telaCheia() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    private final Runnable esconderSelo = () -> selo.setVisibility(View.GONE);

    private void mostrarSelo(String txt, long ms) {
        selo.setText(txt);
        selo.setVisibility(View.VISIBLE);
        selo.removeCallbacks(esconderSelo);
        selo.postDelayed(esconderSelo, ms);
    }

    private void trocarModo() {
        modoCursor = !modoCursor;
        cursor.soltarTudo();
        cursor.setVisibility(modoCursor ? View.VISIBLE : View.GONE);
        mostrarSelo(modoCursor
                ? "Modo cursor: setas movem a seta, OK clica.  (Segure OK para trocar)"
                : "Modo setas: setas rolam a página.  (Segure OK para trocar)", 3500);
    }

    /** Chama um comando do player (play, pause, nexttrack, previoustrack). */
    private void midia(String acao) {
        String js = "(function(){var t=window.__rgTV,h=t&&t.h,a='" + acao + "';"
                + "if(a==='toggle'){var st=navigator.mediaSession&&navigator.mediaSession.playbackState;a=(st==='playing')?'pause':'play';}"
                + "var f=h&&h[a];if(f){try{f({action:a});}catch(e){}return 'ok';}return 'sem';})()";
        web.evaluateJavascript(js, r -> {
            if (r != null && r.contains("sem")) {
                Toast.makeText(this, "Abra o player de chiptune e toque uma música primeiro", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private int seta(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP: return 0;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 1;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 2;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 3;
            default: return -1;
        }
    }

    private final Runnable okSegurado = () -> {
        if (okApertado != null) { okTrocouModo = true; okApertado = null; trocarModo(); }
    };

    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        int code = ev.getKeyCode();
        boolean down = ev.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = ev.getAction() == KeyEvent.ACTION_UP;

        // Voltar: volta uma página no blog; na primeira página, aperte duas vezes para sair de vez.
        if (code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ESCAPE) {
            if (up) voltar();
            return true;
        }

        // Teclas de mídia do controle -> player de chiptune
        if (down && ev.getRepeatCount() == 0) {
            switch (code) {
                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                case KeyEvent.KEYCODE_HEADSETHOOK: midia("toggle"); return true;
                case KeyEvent.KEYCODE_MEDIA_PLAY: midia("play"); return true;
                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                case KeyEvent.KEYCODE_MEDIA_STOP: midia("pause"); return true;
                case KeyEvent.KEYCODE_MEDIA_NEXT:
                case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: midia("nexttrack"); return true;
                case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                case KeyEvent.KEYCODE_MEDIA_REWIND: midia("previoustrack"); return true;
                case KeyEvent.KEYCODE_MENU: trocarModo(); return true;   // controles que têm botão de menu
                default: break;
            }
        }

        // OK: toque curto = clique; segurado = troca entre modo cursor e modo setas
        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A) {
            if (aviso.getVisibility() == View.VISIBLE) {
                if (up) { aviso.setVisibility(View.GONE); web.reload(); }
                return true;
            }
            if (down) {
                if (ev.getRepeatCount() == 0) {
                    okApertado = KeyEvent.changeAction(ev, KeyEvent.ACTION_DOWN);
                    okTrocouModo = false;
                    selo.removeCallbacks(okSegurado);
                    selo.postDelayed(okSegurado, SEGURAR_MS);
                }
                return true;
            }
            if (up) {
                selo.removeCallbacks(okSegurado);
                if (okTrocouModo) { okTrocouModo = false; return true; }
                KeyEvent apertou = okApertado;
                okApertado = null;
                if (modoCursor) cursor.clicar();
                else if (apertou != null) { super.dispatchKeyEvent(apertou); super.dispatchKeyEvent(ev); }
                return true;
            }
            return true;
        }

        // Setas no modo cursor movem a seta (o blog não recebe as teclas)
        int s = seta(code);
        if (modoCursor && s >= 0) {
            if (down && ev.getRepeatCount() == 0) cursor.seta(s, true);
            else if (up) cursor.seta(s, false);
            return true;
        }
        return super.dispatchKeyEvent(ev);
    }

    // Antes de voltar de página: fecha o que estiver aberto por cima (player expandido, foto ampliada).
    private static final String JS_FECHAR =
            "(function(){function vis(e){if(!e)return false;var c=getComputedStyle(e);return c.display!=='none'&&c.visibility!=='hidden';}"
            + "var x=document.querySelector('#rexp.open');if(x){var b=document.getElementById('rexp-close');if(b){b.click();return 'fechou';}}"
            + "var lb=document.getElementById('rg-lightbox');if(vis(lb)){var c=document.getElementById('rg-lightbox-close');if(c){c.click();return 'fechou';}}"
            + "return 'nada';})()";

    private void voltar() {
        if (aviso.getVisibility() == View.VISIBLE) { aviso.setVisibility(View.GONE); return; }
        web.evaluateJavascript(JS_FECHAR, r -> {
            if (r != null && r.contains("fechou")) return;
            voltarPagina();
        });
    }

    private void voltarPagina() {
        if (web.canGoBack()) { web.goBack(); return; }
        long agora = System.currentTimeMillis();
        if (agora - ultimoVoltar < 2500) { sair(); return; }
        ultimoVoltar = agora;
        mostrarSelo("Aperte voltar de novo para sair", 2500);
    }

    /** Fecha de verdade: para a música e encerra o app (não fica rodando escondido). */
    private void sair() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.onPause();
        }
        finishAndRemoveTask();
    }

    @Override
    public void onBackPressed() {
        voltar();     // gesto/voltar vindo por outro caminho
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) telaCheia();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.resumeTimers();
    }

    // Ao sair para a tela inicial a música continua; só pausa de fato quando o app é fechado.
    @Override
    protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            web.destroy();
        }
        super.onDestroy();
    }
}
