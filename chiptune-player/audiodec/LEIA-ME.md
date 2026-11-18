# rg-audiodec — decodificador de áudio gravado do player

`rg-audiodec.js` + `rg-audiodec.wasm` tocam no player os formatos de áudio gravado que o navegador
não abre sozinho: WMA, APE (Monkey's Audio), WavPack, Musepack (MPC), ALAC, TTA, TAK, Shorten,
AC-3/E-AC-3, DTS, DSD (DSF/DFF), AMR, RealAudio, W64.
Só é baixado quando alguém abre um arquivo desses formatos.

É o [FFmpeg](https://ffmpeg.org) 7.1 (licença LGPL 2.1 ou posterior), só com os decodificadores,
compilado para WebAssembly com o Emscripten 3.1.6, mais a ponte `rgdec.c` (desta pasta).

## Como gerar de novo

```sh
git clone --depth 1 --branch n7.1 https://github.com/FFmpeg/FFmpeg.git ffmpeg
cd ffmpeg
DEC="wmav1,wmav2,wmapro,wmalossless,wmavoice,ape,wavpack,mpc7,mpc8,alac,tta,tak,shorten,ac3,eac3,dca,dsd_lsbf,dsd_msbf,dsd_lsbf_planar,dsd_msbf_planar,amrnb,amrwb,ra_144,ra_288,cook,atrac3,atrac3p,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,pcm_u8,mp3float,aac"
DMX="asf,ape,wv,mpc,mpc8,mov,tta,tak,shorten,ac3,eac3,dts,dsf,iff,amr,rm,aa,wav,w64,caf,aiff"
emconfigure ./configure --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=llvm-nm --target-os=none \
  --arch=x86_32 --enable-cross-compile --disable-x86asm --disable-inline-asm --disable-asm --disable-stripping \
  --disable-programs --disable-doc --disable-everything --disable-network --disable-pthreads --disable-w32threads \
  --disable-os2threads --disable-avdevice --disable-swscale --disable-postproc --disable-avfilter --disable-debug \
  --disable-runtime-cpudetect --enable-small --enable-swresample --enable-decoder=$DEC --enable-demuxer=$DMX \
  --enable-parser=ac3,dca,tak,mpegaudio,aac --enable-protocol=file --extra-cflags="-O3"
make -j8 libavformat/libavformat.a libavcodec/libavcodec.a libavutil/libavutil.a libswresample/libswresample.a
cd ..
emcc -O3 rgdec.c -Iffmpeg ffmpeg/libavformat/libavformat.a ffmpeg/libavcodec/libavcodec.a \
  ffmpeg/libswresample/libswresample.a ffmpeg/libavutil/libavutil.a -lm -s MODULARIZE=1 -s EXPORT_NAME=RGAudioDec \
  -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=33554432 -s MAXIMUM_MEMORY=2147483648 -s ENVIRONMENT=web,worker \
  -s FILESYSTEM=0 -s EXPORTED_FUNCTIONS='["_rg_decode","_rg_rate","_rg_left","_rg_right","_rg_free","_rg_title","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32","UTF8ToString","stringToUTF8","lengthBytesUTF8"]' -o rg-audiodec.js
```
