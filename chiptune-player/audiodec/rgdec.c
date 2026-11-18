/* Registro Gamer — decodificador de áudio gravado para o player (formatos que o navegador não abre:
 * WMA, APE, WavPack, Musepack, ALAC, TTA, TAK, Shorten, AC-3/E-AC-3, DTS, DSD, AMR, RealAudio...).
 * FFmpeg mínimo (só decodificadores) compilado para WebAssembly. Recebe o arquivo inteiro na memória
 * e devolve as amostras em estéreo (float), na taxa original do arquivo. */
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libswresample/swresample.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

static const uint8_t *g_data; static int64_t g_size, g_pos;
static int rd(void *o, uint8_t *buf, int n) {
  int64_t left = g_size - g_pos;
  if (left <= 0) return AVERROR_EOF;
  if (n > left) n = (int)left;
  memcpy(buf, g_data + g_pos, n); g_pos += n; return n;
}
static int64_t sk(void *o, int64_t off, int wh) {
  if (wh & AVSEEK_SIZE) return g_size;
  wh &= ~AVSEEK_FORCE;
  int64_t p = wh == SEEK_CUR ? g_pos + off : wh == SEEK_END ? g_size + off : off;
  if (p < 0 || p > g_size) return -1;
  g_pos = p; return p;
}

static float *outL, *outR; static int64_t outN, outCap; static int outRate;
static char g_title[512];

static int grow(int64_t need) {
  if (need <= outCap) return 0;
  int64_t c = outCap ? outCap : (1 << 18);
  while (c < need) c *= 2;
  float *a = realloc(outL, c * 4); if (!a) return -1; outL = a;
  float *b = realloc(outR, c * 4); if (!b) return -1; outR = b;
  outCap = c; return 0;
}

EMSCRIPTEN_KEEPALIVE void rg_free(void) { free(outL); free(outR); outL = outR = NULL; outN = outCap = 0; }
EMSCRIPTEN_KEEPALIVE int rg_rate(void) { return outRate; }
EMSCRIPTEN_KEEPALIVE float *rg_left(void) { return outL; }
EMSCRIPTEN_KEEPALIVE float *rg_right(void) { return outR; }
EMSCRIPTEN_KEEPALIVE const char *rg_title(void) { return g_title; }

/* devolve o número de quadros decodificados (>0) ou um código de erro negativo */
EMSCRIPTEN_KEEPALIVE int rg_decode(const uint8_t *data, int size, const char *fname) {
  AVFormatContext *fc = NULL; AVCodecContext *cc = NULL; SwrContext *swr = NULL;
  AVPacket *pkt = NULL; AVFrame *fr = NULL; AVIOContext *io = NULL;
  int ret = -1, si;
  rg_free(); outRate = 0; g_title[0] = 0;
  g_data = data; g_size = size; g_pos = 0;

  unsigned char *iobuf = av_malloc(65536);
  io = avio_alloc_context(iobuf, 65536, 0, NULL, rd, NULL, sk);
  fc = avformat_alloc_context();
  fc->pb = io; fc->flags |= AVFMT_FLAG_CUSTOM_IO;
  if (avformat_open_input(&fc, fname, NULL, NULL) < 0) { ret = -2; goto fim; }
  if (avformat_find_stream_info(fc, NULL) < 0) { ret = -3; goto fim; }
  const AVCodec *dec = NULL;
  si = av_find_best_stream(fc, AVMEDIA_TYPE_AUDIO, -1, -1, &dec, 0);
  if (si < 0 || !dec) { ret = -4; goto fim; }
  {
    AVDictionaryEntry *t = av_dict_get(fc->metadata, "title", NULL, 0);
    if (!t) t = av_dict_get(fc->streams[si]->metadata, "title", NULL, 0);
    if (t && t->value) { strncpy(g_title, t->value, sizeof g_title - 1); g_title[sizeof g_title - 1] = 0; }
  }
  cc = avcodec_alloc_context3(dec);
  avcodec_parameters_to_context(cc, fc->streams[si]->codecpar);
  if (avcodec_open2(cc, dec, NULL) < 0) { ret = -5; goto fim; }
  pkt = av_packet_alloc(); fr = av_frame_alloc();

  AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
  int eof = 0;
  while (1) {
    if (!eof) {
      int r = av_read_frame(fc, pkt);
      if (r < 0) { eof = 1; avcodec_send_packet(cc, NULL); }
      else { if (pkt->stream_index == si) avcodec_send_packet(cc, pkt); av_packet_unref(pkt); }
    }
    while (1) {
      int r = avcodec_receive_frame(cc, fr);
      if (r == AVERROR(EAGAIN)) { if (eof) goto pronto; break; }
      if (r < 0) goto pronto;   /* fim (ou erro do decodificador): fica o que já saiu */
      if (!swr) {
        outRate = fr->sample_rate ? fr->sample_rate : cc->sample_rate;
        AVChannelLayout in = fr->ch_layout;
        if (in.order == AV_CHANNEL_ORDER_UNSPEC || !in.nb_channels) av_channel_layout_default(&in, fr->ch_layout.nb_channels ? fr->ch_layout.nb_channels : cc->ch_layout.nb_channels);
        if (swr_alloc_set_opts2(&swr, &stereo, AV_SAMPLE_FMT_FLTP, outRate, &in, fr->format, outRate, 0, NULL) < 0 || swr_init(swr) < 0) { ret = -6; goto fim; }
      }
      int n = fr->nb_samples + 256;
      if (grow(outN + n) < 0) { ret = -7; goto fim; }
      uint8_t *o[2] = { (uint8_t *)(outL + outN), (uint8_t *)(outR + outN) };
      int got = swr_convert(swr, o, n, (const uint8_t **)fr->extended_data, fr->nb_samples);
      if (got > 0) outN += got;
      av_frame_unref(fr);
    }
  }
pronto:
  ret = outN > 0 ? (int)outN : -8;
fim:
  if (swr) swr_free(&swr);
  if (fr) av_frame_free(&fr);
  if (pkt) av_packet_free(&pkt);
  if (cc) avcodec_free_context(&cc);
  if (fc) avformat_close_input(&fc);
  if (io) { av_freep(&io->buffer); avio_context_free(&io); }
  return ret;
}
