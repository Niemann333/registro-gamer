package com.niemann333.registrogamer.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.SystemClock;
import android.view.Choreographer;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;

/**
 * Cursor de "mouse" desenhado por cima do blog e movido pelas setas do controle.
 * - setas: movem o cursor (acelera quanto mais tempo segura);
 * - encostado na borda de cima/baixo/lados: rola o que está embaixo do cursor
 *   (a página ou uma lista, como a do player de chiptune);
 * - OK: clica onde o cursor está.
 * O blog recebe os movimentos como mouse de verdade, então os efeitos de "passar o mouse" funcionam.
 */
class Cursor extends View implements Choreographer.FrameCallback {

    private final WebView web;
    private final float dp;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint borda = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path seta = new Path();

    private float x = -1, y = -1;
    private boolean cima, baixo, esq, dir;     // setas seguradas agora
    private long inicio = 0;                   // quando começou a segurar
    private boolean rodando = false;
    private long ultimoMovimento = 0;
    private float alpha = 1f;

    Cursor(Context c, WebView web) {
        super(c);
        this.web = web;
        dp = c.getResources().getDisplayMetrics().density;
        fill.setColor(Color.WHITE);
        borda.setColor(0xFF1B0B33);
        borda.setStyle(Paint.Style.STROKE);
        borda.setStrokeWidth(2 * dp);
        borda.setStrokeJoin(Paint.Join.ROUND);
        // seta clássica de mouse, com a ponta em (0,0)
        float s = 1.25f * dp;
        seta.moveTo(0, 0);
        seta.lineTo(0, 17 * s);
        seta.lineTo(4.5f * s, 12.8f * s);
        seta.lineTo(7.6f * s, 19.5f * s);
        seta.lineTo(10.3f * s, 18.3f * s);
        seta.lineTo(7.3f * s, 11.8f * s);
        seta.lineTo(13 * s, 11.8f * s);
        seta.close();
        setFocusable(false);
        setClickable(false);
    }

    private void centralizar() {
        if (x < 0 && getWidth() > 0) { x = getWidth() / 2f; y = getHeight() / 2f; }
    }

    /** Uma seta foi apertada (true) ou solta (false). */
    void seta(int qual, boolean apertada) {
        centralizar();
        switch (qual) {
            case 0: cima = apertada; break;
            case 1: baixo = apertada; break;
            case 2: esq = apertada; break;
            default: dir = apertada; break;
        }
        boolean alguma = cima || baixo || esq || dir;
        if (apertada && !rodando) {
            inicio = SystemClock.uptimeMillis();
            rodando = true;
            Choreographer.getInstance().postFrameCallback(this);
        }
        if (!alguma) inicio = 0;
        acordar();
    }

    @Override
    public void doFrame(long nanos) {
        boolean alguma = cima || baixo || esq || dir;
        long agora = SystemClock.uptimeMillis();
        if (alguma) {
            // velocidade em dp por quadro: começa devagar (precisão) e acelera
            float seg = (agora - inicio) / 1000f;
            float v = Math.min(22f, 3.5f + seg * 14f) * dp;
            float dx = (dir ? v : 0) - (esq ? v : 0), dy = (baixo ? v : 0) - (cima ? v : 0);
            float nx = Math.max(0, Math.min(getWidth() - 1, x + dx));
            float ny = Math.max(0, Math.min(getHeight() - 1, y + dy));
            // na borda: rola o que está embaixo do cursor (roda do mouse)
            float rolV = 0, rolH = 0, f = Math.min(1.6f, 0.35f + seg * 0.8f);
            if (cima && ny <= 0) rolV = f;
            if (baixo && ny >= getHeight() - 1) rolV = -f;
            if (esq && nx <= 0) rolH = -f;
            if (dir && nx >= getWidth() - 1) rolH = f;
            x = nx; y = ny;
            mover();
            if (rolV != 0 || rolH != 0) rolar(rolV, rolH);
            ultimoMovimento = agora;
            alpha = 1f;
            invalidate();
            Choreographer.getInstance().postFrameCallback(this);
            return;
        }
        // parado: some devagar depois de alguns segundos
        long parado = agora - ultimoMovimento;
        if (parado > 4000 && alpha > 0f) {
            alpha = Math.max(0f, alpha - 0.05f);
            invalidate();
        }
        if (alpha > 0f) Choreographer.getInstance().postFrameCallback(this);
        else rodando = false;
    }

    private void acordar() {
        ultimoMovimento = SystemClock.uptimeMillis();
        alpha = 1f;
        invalidate();
        if (!rodando) { rodando = true; Choreographer.getInstance().postFrameCallback(this); }
    }

    /** Coordenadas do cursor dentro do WebView (o cursor cobre a mesma área). */
    private MotionEvent evento(int acao, long down, int fonte) {
        MotionEvent.PointerProperties[] pp = { new MotionEvent.PointerProperties() };
        pp[0].id = 0;
        pp[0].toolType = fonte == InputDevice.SOURCE_MOUSE ? MotionEvent.TOOL_TYPE_MOUSE : MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords[] pc = { new MotionEvent.PointerCoords() };
        pc[0].x = x; pc[0].y = y; pc[0].pressure = 1f; pc[0].size = 1f;
        return MotionEvent.obtain(down, SystemClock.uptimeMillis(), acao, 1, pp, pc, 0, 0, 1f, 1f, 0, 0, fonte, 0);
    }

    private void mover() {
        MotionEvent e = evento(MotionEvent.ACTION_HOVER_MOVE, SystemClock.uptimeMillis(), InputDevice.SOURCE_MOUSE);
        web.dispatchGenericMotionEvent(e);
        e.recycle();
    }

    private void rolar(float v, float h) {
        MotionEvent.PointerProperties[] pp = { new MotionEvent.PointerProperties() };
        pp[0].id = 0; pp[0].toolType = MotionEvent.TOOL_TYPE_MOUSE;
        MotionEvent.PointerCoords[] pc = { new MotionEvent.PointerCoords() };
        pc[0].x = x; pc[0].y = y;
        pc[0].setAxisValue(MotionEvent.AXIS_VSCROLL, v);
        pc[0].setAxisValue(MotionEvent.AXIS_HSCROLL, h);
        long t = SystemClock.uptimeMillis();
        MotionEvent e = MotionEvent.obtain(t, t, MotionEvent.ACTION_SCROLL, 1, pp, pc, 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_MOUSE, 0);
        web.dispatchGenericMotionEvent(e);
        e.recycle();
    }

    /** Clique (toque rápido) onde o cursor está. */
    void clicar() {
        centralizar();
        long t = SystemClock.uptimeMillis();
        MotionEvent d = evento(MotionEvent.ACTION_DOWN, t, InputDevice.SOURCE_TOUCHSCREEN);
        web.dispatchTouchEvent(d);
        d.recycle();
        MotionEvent u = evento(MotionEvent.ACTION_UP, t, InputDevice.SOURCE_TOUCHSCREEN);
        web.dispatchTouchEvent(u);
        u.recycle();
        acordar();
    }

    void soltarTudo() { cima = baixo = esq = dir = false; inicio = 0; }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        if (x < 0 || x >= w || y >= h) { x = w / 2f; y = h / 2f; }
    }

    @Override
    protected void onDraw(Canvas c) {
        if (getVisibility() != VISIBLE || alpha <= 0f || x < 0) return;
        int a = (int) (255 * alpha);
        fill.setAlpha(a);
        borda.setAlpha(a);
        c.save();
        c.translate(x, y);
        c.drawPath(seta, fill);
        c.drawPath(seta, borda);
        c.restore();
    }
}
