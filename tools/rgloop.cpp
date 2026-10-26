// rgloop — detecta o ponto exato de loop de músicas NSF/GBS/KSS/SAP/AY
// observando as escritas nos registradores do chip de som, quadro a quadro.
// Uso: rgloop arquivo [faixa_inicial faixa_final] [max_segundos]
// Saída: uma linha JSON por faixa.
#include "gme/gme.h"
#include "gme/rg_reglog.h"
#include <sidplayfp/sidplayfp.h>
#include <sidplayfp/SidTune.h>
#include <sidplayfp/SidConfig.h>
#include <sidplayfp/SidInfo.h>
#include "sidlite.h"
#include <algorithm>
extern "C" { extern void (*rg_sid_w)(unsigned long long clk, int addr, int data); }
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>
#include <cmath>

struct Frame { long long clk; uint64_t h; int n; };
static std::vector<Frame> frames;
static uint64_t curH; static int curN; static bool started;

static const uint64_t FNV0 = 1469598103934665603ULL, FNVP = 1099511628211ULL;

// estado dos registradores (para a comparação tolerante)
static const int RMAX = 384;
static int regIdx[0x20000]; static int nRegs; static uint8_t curV[RMAX];
static std::vector<uint8_t> snaps;      // N x RMAX
static int latch[256];
static void setReg(unsigned v, int d) {
	int k = regIdx[v];
	if (!k) { if (nRegs >= RMAX) return; k = regIdx[v] = ++nRegs; }
	curV[k - 1] = (uint8_t)d;
}
static void on_w(unsigned a, int d) {
	if (a & 0x10000) {        // porta de E/S (Z80): pares endereço/dado
		unsigned p = a & 0xFF, hi = (a >> 8) & 0xFF;
		bool isLatch = (p == 0xA0 || p == 0x7C || p == 0xC0 || p == 0xC4 || (hi == 0xFF && p == 0xFD));
		bool isData  = (p == 0xA1 || p == 0x7D || p == 0xC1 || p == 0xC5 || (hi == 0xBF && p == 0xFD));
		if (isLatch) latch[p == 0xFD ? 0 : p] = d;
		else if (isData) { int L = latch[p == 0xFD ? 0 : (p - 1)]; setReg(0x10000 | ((p & 0xFF) << 8) | (L & 0xFF), d); }
		else if ((p == 0x7E || p == 0x7F || p == 0x06) && (d & 0x80)) { latch[1] = (d >> 4) & 7; setReg(0x1F000 | latch[1], d & 0x0F); }
		else if (p == 0x7E || p == 0x7F || p == 0x06) setReg(0x1F010 | latch[1], d);
		else setReg(0x10000 | p, d);
	} else setReg(a & 0xFFFF, d);
	uint64_t x = ((uint64_t)a << 8) | (unsigned)d;
	for (int i = 0; i < 4; i++) { curH ^= (x >> (i * 8)) & 0xFF; curH *= FNVP; }
	curN++;
}
static void on_f(long t) {
	// fecha o quadro anterior (as escritas desde a última chamada do play)
	if (started && !frames.empty()) { frames.back().h = curH; frames.back().n = curN; snaps.insert(snaps.end(), curV, curV + RMAX); }
	Frame f; f.clk = rg_rl_base + t; f.h = 0; f.n = 0;
	frames.push_back(f); started = true;
	curH = FNV0; curN = 0;
}

struct Res { int kind; long S; long P; };   // kind 0 = nada, 1 = loop, 2 = fim (cauda estática)

// Menor início S tal que h[i] == h[i+P] para todo i >= S, com pelo menos uma
// repetição completa confirmada (cauda >= P) e cauda mínima de minTail quadros.
static Res detect(const std::vector<Frame>& fr, long N, long minTail) {
	Res best = {0, -1, -1};
	if (N < 4) return best;
	long maxP = N / 2;
	for (long P = 1; P <= maxP; P++) {
		long k = 0;
		while (N - 1 - k - P >= 0 && fr[N - 1 - k].h == fr[N - 1 - k - P].h) k++;
		if (k < P || k < minTail) continue;
		long S = N - k - P;
		if (P == 1) { best.kind = 1; best.S = S; best.P = 1; return best; }
		if (best.kind == 0 || S < best.S) { best.kind = 1; best.S = S; best.P = P; }
		if (S == 0) break;
	}
	return best;
}


// Comparação tolerante: o estado de cada registrador no quadro i deve aparecer
// no quadro i+L com folga de +-1 quadro (absorve o "tremido" de drivers com
// tempo fracionário, em que a nota cai um quadro antes ou depois a cada volta).
static inline bool lmatch(long i, long j, int R, int level) {
	const uint8_t* a = &snaps[(size_t)i * RMAX];
	const uint8_t* b1 = &snaps[(size_t)j * RMAX];
	if (level == 0) return memcmp(a, b1, R) == 0;
	const uint8_t* b0 = b1 - RMAX; const uint8_t* b2 = b1 + RMAX;
	int bad = 0;
	for (int r = 0; r < R; r++) {
		uint8_t v = a[r];
		if (v != b1[r] && v != b0[r] && v != b2[r]) {
			if (level == 1) return false;
			int d = abs(v - b1[r]), d0 = abs(v - b0[r]), d2 = abs(v - b2[r]);
			if (d0 < d) d = d0; if (d2 < d) d = d2;
			if (d > 6 || ++bad > 3) return false;   // só diferenças pequenas (vibrato), nunca uma nota diferente
		}
	}
	return true;
}
static inline bool fmatch(long i, long j, int R) { return lmatch(i, j, R, 2); }

// Dado o período L: escolhe o nível de tolerância mais estrito que ainda confirma
// a metade final, e acha o começo do loop (onde termina a introdução) nesse nível.
// Começo do loop: andando de trás para frente, o ponto em que as diferenças
// ficam densas (>= 30% numa janela de ~2 s) é a introdução; o loop começa logo
// depois da última diferença dessa janela. Diferenças isoladas no meio não contam.
static long scanS(long N, long L, int level, long W) {
	int R = nRegs; long b = N - 2 - L;
	if (W < 16) W = 16;
	std::vector<char> bad(b + 2, 0);
	long sum = 0;
	for (long i = b; i >= 1; i--) {
		bad[i] = lmatch(i, i + L, R, level) ? 0 : 1;
		sum += bad[i];
		if (i + W <= b) sum -= bad[i + W];
		if (i + W <= b + 1 && sum * 10 >= W * 3) {
			long mm = i;
			for (long k = i + W - 1; k >= i; k--) if (bad[k]) { mm = k; break; }
			return mm + 1;
		}
	}
	return 0;
}
static long refineS(long N, long L, int* levelOut, long W) {
	int R = nRegs;
	long a = N / 2, b = N - 2 - L;
	if (b <= a + 10) { *levelOut = -1; return -1; }
	int level = -1;
	for (int lv = 0; lv <= 2 && level < 0; lv++) {
		long c = 0, m = 0;
		for (long k = a; k <= b; k++) { c++; if (!lmatch(k, k + L, R, lv)) m++; }
		if (m * (lv == 2 ? 50 : 200) <= c) level = lv;
	}
	*levelOut = level;
	if (level < 0) return -1;
	return scanS(N, L, level, W);
}
static Res fuzzy(long N, long Lmin) {
	Res best = {0, -1, -1};
	int R = nRegs;
	for (long L = Lmin; L <= N / 2; L++) {
		long i = N - 2 - L; if (i < 1) break;
		long cnt = 0, mism = 0, S = -1; int win[32] = {0}; int wsum = 0; long lastMis[32]; int wp = 0;
		for (; i >= 1; i--) {
			bool ok = fmatch(i, i + L, R);
			cnt++; if (!ok) mism++;
			wsum -= win[wp]; win[wp] = ok ? 0 : 1; lastMis[wp] = i; wsum += win[wp]; wp = (wp + 1) & 31;
			if (wsum >= 8) {        // começou a região que não repete (a introdução)
				long m = -1;
				for (int q = 0; q < 32; q++) if (win[q] && lastMis[q] > m) m = lastMis[q];
				S = m + 1; break;
			}
			if (cnt > 400 && mism * 50 > cnt) break;   // > 2% de diferenças: não é este L
		}
		if (i < 1 && mism * 50 <= cnt) S = 0;
		if (S < 0) continue;
		long tail = N - 1 - S;
		if (tail < 2 * L || S > N / 2) continue;   // tem que repetir pelo menos na metade final inteira
		// conta as diferenças só da região [S, fim) para validar
		long c2 = 0, m2 = 0;
		for (long k = S; k <= N - 2 - L; k++) { c2++; if (!fmatch(k, k + L, R)) m2++; }
		if (m2 * 50 > c2) continue;
		// o menor período válido até o fim é o loop de verdade (os maiores são múltiplos dele)
		best.kind = 1; best.S = S; best.P = L; break;
	}
	return best;
}

struct Chunk { double t; double rms; };
static std::vector<Chunk> chunks;   // nível do áudio ao longo do tempo (só GME)
static void resetLog() {
	chunks.clear();
	frames.clear(); frames.reserve(60 * 800); snaps.clear(); memset(regIdx, 0, sizeof regIdx); nRegs = 0;
	memset(curV, 0, sizeof curV); memset(latch, 0, sizeof latch); started = false; curH = FNV0; curN = 0;
	rg_rl_base = 0; rg_rl_rate = 0;
}
static double fpsOf(long N) {
	return (N > 1 && rg_rl_rate) ? (double)rg_rl_rate * (N - 1) / (frames[N - 1].clk - frames[0].clk) : 60;
}

// Média do nível entre t0 e t1 (segundos); -1 se não há áudio medido
static double rmsBetween(double t0, double t1) {
	double s = 0; int n = 0;
	for (auto& c : chunks) if (c.t >= t0 && c.t <= t1) { s += c.rms; n++; }
	return n ? s / n : -1;
}
// Primeiro instante depois de t0 em que o som some de vez (3 s seguidos de silêncio)
static double silenceAfter(double t0) {
	if (chunks.empty()) return -1;
	for (size_t i = 0; i < chunks.size(); i++) {
		if (chunks[i].t < t0) continue;
		if (chunks[i].t > t0 + 15) break;
		bool ok = true;
		for (size_t j = i; j < chunks.size() && chunks[j].t < chunks[i].t + 3; j++) if (chunks[j].rms >= 12) { ok = false; break; }
		if (ok) return chunks[i].t - 2048.0 / 11025;
	}
	return -1;
}
// Analisa o log de quadros já montado e imprime o resultado da faixa.
static void analyze(int tr, double skipMs, double played, bool ended, Res r) {
	long N = (long)frames.size() - 1;      // o último quadro ainda está aberto
	if (N < 10) { printf("{\"t\":%d,\"nada\":1,\"N\":%ld}\n", tr, N); return; }
	double fps = fpsOf(N);
	if (!r.kind) r = detect(frames, N, (long)(fps * 20));
	double rate = rg_rl_rate ? rg_rl_rate : 1;
	auto ms = [&](long i) { return (frames[i].clk - frames[0].clk) / rate * 1000.0 + frames[0].clk / rate * 1000.0; };
	long writes = 0; for (long i = 0; i < N; i++) writes += frames[i].n;
	if (getenv("RGDUMP")) {
		FILE* df = fopen(getenv("RGDUMP"), "wb");
		int R = nRegs; fwrite(&R, 4, 1, df); fwrite(&N, 8, 1, df);
		for (unsigned v = 0; v < 0x20000; v++) if (regIdx[v]) { int k = regIdx[v]; fwrite(&v, 4, 1, df); fwrite(&k, 4, 1, df); }
		for (long i = 0; i < N; i++) fwrite(&snaps[(size_t)i * RMAX], 1, R, df);
		for (long i = 0; i < N; i++) { double c = frames[i].clk / rate; fwrite(&c, 8, 1, df); }
		fclose(df);
	}
	// fim: o driver parou (ou só repete algo mudo); a faixa acaba quando o som some
	auto printFim = [&](double tS) {
		double e = silenceAfter(tS);
		if (e < 0) e = tS + (chunks.empty() ? 0.0 : 1.0);   // nota presa: corta 1 s depois
		if (e < tS) e = tS;
		double E_ms = e * 1000 - skipMs;
		printf("{\"t\":%d,\"fim\":%.0f,\"skip\":%.0f,\"w\":%ld}\n", tr, E_ms < 0 ? 0 : E_ms, skipMs, writes);
	};
	bool parado = r.kind == 1 && (ms(r.S + r.P) - ms(r.S)) < 1500;
	if (parado) { printFim(ms(r.S) / 1000); return; }
	Res fr = fuzzy(N, (long)(fps * 3));
	// período: o exato, a não ser que o tolerante ache um menor (tempo fracionário)
	long L = -1; const char* how = "";
	if (r.kind == 1) { L = r.P; how = "exato"; }
	if (fr.kind == 1 && (L < 0 || fr.P < L - 2)) { L = fr.P; how = "tolerante"; }
	long W = (long)(fps * 2);
	int level = -1; long S = -1;
	if (L > 0) S = refineS(N, L, &level, W);
	if (S < 0 && r.kind == 1) { S = r.S; L = r.P; level = 9; how = "exato"; }
	if (S >= 0) {
		// começo musical do loop: o ponto mais cedo em que as notas já se repetem
		long S2 = level < 9 ? scanS(N, L, 2, W) : S;
		if (S2 > S) S2 = S;
		double I_ms = ms(S2) - skipMs, Ie_ms = ms(S) - skipMs, L_ms = ms(S + L) - ms(S);
		if (I_ms < 0) I_ms = 0; if (Ie_ms < 0) Ie_ms = 0;
		// loop mudo (driver repetindo escritas sem som) = a música acabou
		double lv = rmsBetween(ms(S) / 1000, ms(S + L) / 1000);
		if (lv >= 0 && lv < 12) { printFim(ms(S) / 1000); return; }
		printf("{\"t\":%d,\"intro\":%.0f,\"loop\":%.0f,\"intro_exata\":%.0f,\"nivel\":%d,\"modo\":\"%s\",\"skip\":%.0f,\"w\":%ld,\"N\":%ld}\n",
			tr, I_ms, L_ms, Ie_ms, level, how, skipMs, writes, N);
	} else {
		printf("{\"t\":%d,\"nada\":1,\"ended\":%d,\"N\":%ld,\"w\":%ld,\"secs\":%.0f,\"skip\":%.0f}\n", tr, ended ? 1 : 0, N, writes, played, skipMs);
	}
}

// ── SID (libsidplayfp): escritas com o relógio da CPU; os quadros saem dos "surtos" de escrita
struct SW { unsigned long long c; int a, d; };
static std::vector<SW> sidw;
static void on_sid(unsigned long long c, int a, int d) { sidw.push_back({c, a, d}); }

static int runSid(const char* path, int t0, int t1, double maxS) {
	SidTune probe(path);
	if (!probe.getStatus()) { printf("{\"erro\":\"abrir\"}\n"); return 1; }
	int count = probe.getInfo()->songs();
	if (t1 < 0 || t1 >= count) t1 = count - 1;
	for (int tr = t0; tr <= t1; tr++) {
		sidplayfp eng;
		SIDLiteBuilder b("rg");
		SidConfig cfg; cfg.frequency = 11025; cfg.sidEmulation = &b;
		if (!eng.config(cfg)) { printf("{\"t\":%d,\"erro\":\"config\"}\n", tr); continue; }
		SidTune tune(path);
		tune.selectSong(tr + 1);
		sidw.clear(); sidw.reserve(4000000);
		rg_sid_w = on_sid;
		if (!eng.load(&tune)) { rg_sid_w = 0; printf("{\"t\":%d,\"erro\":\"load\"}\n", tr); continue; }
		double cpu = tune.getInfo()->clockSpeed() == SidTuneInfo::CLOCK_NTSC ? 1022727.14 : 985248.4;
		unsigned long long total = (unsigned long long)(maxS * cpu);
		while (eng.timeMs() < maxS * 1000) { int n = eng.play(20000); if (n < 0) break; }
		rg_sid_w = 0;
		resetLog(); rg_rl_rate = (long)cpu;
		if (sidw.size() < 100) { printf("{\"t\":%d,\"nada\":1,\"w\":%zu}\n", tr, sidw.size()); continue; }
		// início de cada surto (= cada chamada do play)
		std::vector<unsigned long long> bs; unsigned long long last = 0;
		for (size_t i = 0; i < sidw.size(); i++) { if (i == 0 || sidw[i].c - last > 1500) bs.push_back(sidw[i].c); last = sidw[i].c; }
		std::vector<unsigned long long> df;
		for (size_t i = 1; i < bs.size() && i < 4000; i++) df.push_back(bs[i] - bs[i - 1]);
		std::sort(df.begin(), df.end());
		double period = df.empty() ? cpu / 50 : (double)df[df.size() / 2];
		if (period < 1000) period = cpu / 50;
		double tz = (bs.size() > 1 ? (double)bs[1] : (double)bs[0]) - period * 0.25;   // fase: um pouco antes do surto
		long k = -1;
		for (size_t i = 0; i < sidw.size(); i++) {
			double c = (double)sidw[i].c;
			long kk = c < tz ? -1 : (long)((c - tz) / period);
			while (k < kk) { k++; rg_rl_base = 0; on_f((long)(tz + k * period)); }
			on_w(0xD400 | sidw[i].a, sidw[i].d);
		}
		long endk = (long)(((double)total - tz) / period);
		while (k < endk) { k++; on_f((long)(tz + k * period)); }
		Res r = {0, -1, -1};
		analyze(tr, 0, maxS, false, r);
		fflush(stdout);
	}
	return 0;
}

int main(int argc, char** argv) {
	if (argc < 2) { fprintf(stderr, "uso: rgloop arquivo [t0 t1] [max_s]\n"); return 1; }
	const char* path = argv[1];
	int t0 = argc > 3 ? atoi(argv[2]) : 0, t1 = argc > 3 ? atoi(argv[3]) : -1;
	double maxS = argc > 4 ? atof(argv[4]) : 720;
	size_t pl = strlen(path);
	if (pl > 4 && !strcasecmp(path + pl - 4, ".sid")) return runSid(path, t0, t1, maxS);

	const int RATE = 11025;
	Music_Emu* emu = 0;
	if (gme_open_file(path, &emu, RATE)) { printf("{\"erro\":\"abrir\"}\n"); return 1; }
	int count = gme_track_count(emu);
	if (t1 < 0 || t1 >= count) t1 = count - 1;
	gme_delete(emu);

	for (int tr = t0; tr <= t1; tr++) {
		// 1) silêncio inicial que o GME pula (o player do site faz o mesmo)
		double skipMs = 0;
		{
			Music_Emu* e2 = 0;
			if (!gme_open_file(path, &e2, 44100)) {
				rg_rl_w = 0; rg_rl_f = 0; rg_rl_skip = 0;
				gme_ignore_silence(e2, 0);
				gme_start_track(e2, tr);
				skipMs = rg_rl_skip / 2.0 / 44100.0 * 1000.0;
				gme_delete(e2);
			}
		}
		// 2) log das escritas
		if (gme_open_file(path, &emu, RATE)) continue;
		gme_ignore_silence(emu, 1);
		resetLog();
		rg_rl_w = on_w; rg_rl_f = on_f;
		gme_start_track(emu, tr);
		short buf[2 * 2048];
		double played = 0; Res r = {0, -1, -1}; bool ended = false;
		double nextCheck = 240;
		while (played < maxS) {
			if (gme_play(emu, 2 * 2048, buf)) { ended = true; break; }
			{ double q = 0; for (int i = 0; i < 2 * 2048; i++) q += (double)buf[i] * buf[i]; chunks.push_back({played, sqrt(q / (2 * 2048))}); }
			played += 2048.0 / RATE;
			if (gme_track_ended(emu)) { ended = true; break; }
			if (played >= nextCheck) {
				nextCheck += 120;
				long N = (long)frames.size() - 1;
				r = detect(frames, N, (long)(fpsOf(N) * 20));
				// confia quando o loop já foi visto inteiro pelo menos 2 vezes depois do início
				if (r.kind == 1 && N - r.S >= 3 * r.P) break;
				r.kind = 0;
			}
		}
		rg_rl_w = 0; rg_rl_f = 0;
		// KSS: o GME não emula o FM (FM-PAC/MSX-AUDIO); o som dele não serve de referência
		if (pl > 4 && !strcasecmp(path + pl - 4, ".kss")) chunks.clear();
		analyze(tr, skipMs, played, ended, r);
		fflush(stdout);
		gme_delete(emu); emu = 0;
	}
	return 0;
}
