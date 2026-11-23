// Registro Gamer: entrada MIDI pelo Web MIDI do navegador (build Emscripten)
// A página (tracker.html) escuta os teclados MIDI e coloca as mensagens em Module.rgMidiQ.
#ifdef __EMSCRIPTEN__
#include "webmidi.h"
#include "../ta-log.h"
#include <emscripten.h>

EM_JS(int, rgMidiPop, (unsigned char* buf), {
  var q = Module.rgMidiQ;
  if (!q || !q.length) return 0;
  var m = q.shift(), n = Math.min(m.length, 64);
  for (var i = 0; i < n; i++) HEAPU8[buf + i] = m[i];
  return n;
});
EM_JS(void, rgMidiSetOpen, (int on), {
  Module.rgMidiOpen = !!on;
  if (!on) Module.rgMidiQ = [];
  if (Module.onRgMidiOpen) Module.onRgMidiOpen(!!on);
});

bool TAMidiInWeb::gather() {
  if (!isOpen) return false;
  unsigned char buf[64];
  int n;
  while ((n=rgMidiPop(buf))>0) {
    TAMidiMessage m;
    m.type=buf[0];
    if (m.type==TA_MIDI_SYSEX) continue;
    if (n>1) memcpy(m.data,buf+1,MIN(n-1,7));
    queue.push(m);
  }
  return true;
}

bool TAMidiInWeb::isDeviceOpen() { return isOpen; }

bool TAMidiInWeb::openDevice(String name) {
  isOpen=true;
  rgMidiSetOpen(1);
  logI("web MIDI input open (%s)",name);
  return true;
}

bool TAMidiInWeb::closeDevice() {
  isOpen=false;
  rgMidiSetOpen(0);
  return true;
}

std::vector<String> TAMidiInWeb::listDevices() {
  std::vector<String> ret;
  ret.push_back(WEB_MIDI_ALL);
  return ret;
}

bool TAMidiInWeb::init() { return true; }
bool TAMidiInWeb::quit() { closeDevice(); return true; }

bool TAMidiOutWeb::send(const TAMidiMessage& what) { return false; }
bool TAMidiOutWeb::isDeviceOpen() { return false; }
bool TAMidiOutWeb::openDevice(String name) { return false; }
bool TAMidiOutWeb::closeDevice() { return true; }
std::vector<String> TAMidiOutWeb::listDevices() { return std::vector<String>(); }
bool TAMidiOutWeb::init() { return true; }
bool TAMidiOutWeb::quit() { return true; }
#endif
