s=open('estudio.src.html').read()
syn=open('synth-worklet.js').read(); vgm=open('sid-rip.js').read().replace("if (typeof module !== 'undefined') module.exports = RGSID;","")+'\n'+open('fmt-import.js').read()+'\n'+open('vgm-timbres.js').read().replace("if (typeof module !== 'undefined') module.exports = RGVGM;","")
assert '</script' not in syn and '</script' not in vgm
mid=open('vgm-midi.js').read().replace("if (typeof module !== 'undefined') module.exports = RGMIDI;","")
assert '</script' not in mid
fur=open('vgm-fur.js').read()
fur=fur[:fur.index("if (typeof module !== 'undefined') module.exports")]
assert '</script' not in fur
s=s.replace('/*@@SYNTH@@*/',syn).replace('/*@@VGM@@*/',vgm).replace('/*@@MIDI@@*/',mid).replace('/*@@FUR@@*/',fur)
open('/home/claude/niemann333/registro-gamer/chiptune-player/vgm-midi.js','w').write('// Leitor de VGM + conversores para MIDI e Furnace (Chiptune Studio · Registro Gamer)\n'+vgm+'\n'+mid+'\n'+fur)
open('/home/claude/niemann333/registro-gamer/chiptune-player/estudio.html','w').write(s)
print(len(s))
