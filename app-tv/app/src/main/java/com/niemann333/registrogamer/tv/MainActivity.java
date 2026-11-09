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
    private long ultimoVoltar = 0;

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

    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        if (ev.getAction() != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(ev);
        switch (ev.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
                midia("toggle"); return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                midia("play"); return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                midia("pause"); return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                midia("nexttrack"); return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                midia("previoustrack"); return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (aviso.getVisibility() == View.VISIBLE) {
                    aviso.setVisibility(View.GONE);
                    web.reload();
                    return true;
                }
                break;
            default:
                break;
        }
        return super.dispatchKeyEvent(ev);
    }

    @Override
    public void onBackPressed() {
        if (aviso.getVisibility() == View.VISIBLE) { aviso.setVisibility(View.GONE); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        long agora = System.currentTimeMillis();
        if (agora - ultimoVoltar < 2000) { super.onBackPressed(); return; }
        ultimoVoltar = agora;
        Toast.makeText(this, "Aperte voltar de novo para sair", Toast.LENGTH_SHORT).show();
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
