// Registro Gamer: entrada MIDI pelo Web MIDI do navegador (build Emscripten)
#ifndef _WEBMIDI_H
#define _WEBMIDI_H
#include "taAudio.h"

#define WEB_MIDI_ALL "Teclado MIDI do navegador"

class TAMidiInWeb: public TAMidiIn {
  bool isOpen;
  public:
    bool gather();
    bool isDeviceOpen();
    bool openDevice(String name);
    bool closeDevice();
    std::vector<String> listDevices();
    bool init();
    bool quit();
    TAMidiInWeb(): isOpen(false) {}
};

class TAMidiOutWeb: public TAMidiOut {
  public:
    bool send(const TAMidiMessage& what);
    bool isDeviceOpen();
    bool openDevice(String name);
    bool closeDevice();
    std::vector<String> listDevices();
    bool init();
    bool quit();
};
#endif
