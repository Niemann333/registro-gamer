/**
 * Furnace Tracker - multi-system chiptune tracker
 * Copyright (C) 2021-2026 tildearrow and contributors
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

// RG: skins (visual completo) do Tracker do Registro Gamer.
// Uma skin troca de uma vez cores, fontes, cantos e bordas. As janelas e as funções não mudam.
// A mesma escolha vale no Chiptune Studio (a página guarda "rgSkin" no navegador; as duas leem a mesma chave).

#include "gui.h"
#include "imgui_internal.h"
#include "guiConst.h"

int rgGreenColor(int i, unsigned int def);

struct RGSkinColor {
  int id;
  unsigned int rgb;
  unsigned char a;
};

#define C(x,rgb,a) {GUI_COLOR_##x,rgb,a}

// ---------- Chiptune Studio: azul-roxo da página do Studio ----------
static const RGSkinColor skinStudio[]={
  C(BACKGROUND,0x0c0a14,255), C(FRAME_BACKGROUND,0x13101f,250), C(FRAME_BACKGROUND_CHILD,0x13101f,0),
  C(FRAME_BACKGROUND_POPUP,0x1b1730,250), C(MODAL_BACKDROP,0x000000,160), C(HEADER,0x1b1730,255),
  C(TEXT,0xe9e4ff,255), C(TEXT_DISABLED,0x6f6699,255), C(ACCENT_PRIMARY,0xa855f7,255), C(ACCENT_SECONDARY,0x8b5cf6,255),
  C(TITLE_INACTIVE,0x0c0a14,255), C(TITLE_COLLAPSED,0x000000,130), C(MENU_BAR,0x13101f,255),
  C(BORDER,0x2c2547,200), C(BORDER_SHADOW,0x000000,0),
  C(SCROLL_BACKGROUND,0x0c0a14,120), C(SCROLL,0x3d3363,255), C(SCROLL_HOVER,0x6d4bb0,255), C(SCROLL_ACTIVE,0xc084fc,255),
  C(SEPARATOR,0x2c2547,200), C(SEPARATOR_HOVER,0xa855f7,200), C(SEPARATOR_ACTIVE,0xc084fc,255),
  C(DOCKING_PREVIEW,0xa855f7,150), C(DOCKING_EMPTY,0x0c0a14,255),
  C(TABLE_HEADER,0x1b1730,255), C(TABLE_BORDER_HARD,0x3d3363,255), C(TABLE_BORDER_SOFT,0x2c2547,255), C(TABLE_ROW_ODD,0xa855f7,12),
  C(PLOT_LINES,0xc084fc,255), C(PLOT_HISTOGRAM,0xc084fc,255), C(PLOT_HISTOGRAM_HOVER,0xe9d5ff,255),
  C(OSC_BG1,0x1b1730,255), C(OSC_BG2,0x1b1730,255), C(OSC_BG3,0x0c0a14,255), C(OSC_BG4,0x0c0a14,255), C(OSC_WAVE,0xc084fc,255),
  C(CHANNEL_BG,0x2a1f4a,255), C(CHANNEL_FG,0xe9e4ff,255),
  C(PATTERN_BG,0x0c0a14,0),
  C(PATTERN_ACTIVE,0xe9e4ff,255), C(PATTERN_ACTIVE_HI1,0xf3e8ff,255), C(PATTERN_ACTIVE_HI2,0xffffff,255),
  C(PATTERN_INACTIVE,0x4a4170,255), C(PATTERN_INACTIVE_HI1,0x5b4f8a,255), C(PATTERN_INACTIVE_HI2,0x6d60a3,255),
  C(PATTERN_ROW_INDEX,0xa99fd0,255), C(PATTERN_ROW_INDEX_HI1,0xc084fc,255), C(PATTERN_ROW_INDEX_HI2,0xe9d5ff,255),
  C(PATTERN_HI_1,0xa855f7,20), C(PATTERN_HI_2,0xa855f7,40),
  C(PATTERN_CURSOR,0x6d28d9,255), C(PATTERN_CURSOR_HOVER,0x7c3aed,255), C(PATTERN_CURSOR_ACTIVE,0x8b5cf6,255),
  C(PATTERN_SELECTION,0xa855f7,80), C(PATTERN_SELECTION_HOVER,0xa855f7,110), C(PATTERN_SELECTION_ACTIVE,0xc084fc,140),
  C(PATTERN_PLAY_HEAD,0xa855f7,60),
  C(PATTERN_INS,0x7dd3fc,255),
  C(ORDER_ROW_INDEX,0xa99fd0,255), C(ORDER_ACTIVE,0xe9e4ff,255), C(ORDER_SELECTED,0xc084fc,255), C(ORDER_SIMILAR,0x8b7fc0,255), C(ORDER_INACTIVE,0x5b4f8a,255),
  {-1,0,0}
};

// ---------- janela clássica do Windows (FamiTracker e OpenMPT) ----------
static const RGSkinColor skinWindowsChrome[]={
  C(BACKGROUND,0xababab,255), C(FRAME_BACKGROUND,0xf0f0f0,255), C(FRAME_BACKGROUND_CHILD,0xf0f0f0,0),
  C(FRAME_BACKGROUND_POPUP,0xf2f2f2,255), C(MODAL_BACKDROP,0x000000,90), C(HEADER,0xdcdcdc,255),
  C(TEXT,0x000000,255), C(TEXT_DISABLED,0x6d6d6d,255), C(ACCENT_PRIMARY,0x0078d7,255), C(ACCENT_SECONDARY,0x3399ff,255),
  C(TITLE_INACTIVE,0xe6e6e6,255), C(TITLE_COLLAPSED,0xe6e6e6,200), C(TITLE_BACKGROUND_ACTIVE,0xd6e3f2,255), C(MENU_BAR,0xf0f0f0,255),
  C(BORDER,0x8c8c8c,255), C(BORDER_SHADOW,0xffffff,0),
  C(SCROLL_BACKGROUND,0xf0f0f0,255), C(SCROLL,0xcdcdcd,255), C(SCROLL_HOVER,0xa6a6a6,255), C(SCROLL_ACTIVE,0x606060,255),
  C(SEPARATOR,0xa0a0a0,255), C(SEPARATOR_HOVER,0x0078d7,200), C(SEPARATOR_ACTIVE,0x0078d7,255),
  C(DOCKING_PREVIEW,0x0078d7,120), C(DOCKING_EMPTY,0xababab,255),
  C(TABLE_HEADER,0xe5e5e5,255), C(TABLE_BORDER_HARD,0xa0a0a0,255), C(TABLE_BORDER_SOFT,0xd0d0d0,255),
  C(TABLE_ROW_EVEN,0xffffff,0), C(TABLE_ROW_ODD,0x000000,10),
  C(DRAG_DROP_TARGET,0x0078d7,255), C(NAV_HIGHLIGHT,0x0078d7,255), C(NAV_WIN_HIGHLIGHT,0x0078d7,200), C(NAV_WIN_BACKDROP,0x000000,60),
  C(PLOT_LINES,0x0078d7,255), C(PLOT_LINES_HOVER,0x004c87,255), C(PLOT_HISTOGRAM,0x0078d7,255), C(PLOT_HISTOGRAM_HOVER,0x004c87,255),
  C(BUTTON,0xe1e1e1,255), C(BUTTON_HOVER,0xe5f1fb,255), C(BUTTON_ACTIVE,0xcce4f7,255),
  C(TAB,0xe1e1e1,255), C(TAB_HOVER,0xe5f1fb,255), C(TAB_ACTIVE,0xffffff,255), C(TAB_UNFOCUSED,0xe1e1e1,255), C(TAB_UNFOCUSED_ACTIVE,0xf7f7f7,255),
  C(TAB_SELECTED_OVERLINE,0x0078d7,255), C(TAB_DIMMED_SELECTED_OVERLINE,0xa0a0a0,255),
  C(IMGUI_HEADER,0xcce8ff,255), C(IMGUI_HEADER_HOVER,0xe5f3ff,255), C(IMGUI_HEADER_ACTIVE,0x99d1ff,255),
  C(RESIZE_GRIP,0xa0a0a0,120), C(RESIZE_GRIP_HOVER,0x0078d7,170), C(RESIZE_GRIP_ACTIVE,0x0078d7,240),
  C(WIDGET_BACKGROUND,0xffffff,255), C(WIDGET_BACKGROUND_HOVER,0xffffff,255), C(WIDGET_BACKGROUND_ACTIVE,0xf3f9ff,255),
  C(SLIDER_GRAB,0x0078d7,255), C(SLIDER_GRAB_ACTIVE,0x004c87,255),
  C(CHECK_MARK,0x000000,255), C(CHECKBOX_BACKGROUND_ACTIVE,0xffffff,255),
  C(TEXT_SELECTION,0x3399ff,110), C(INPUT_TEXT_CURSOR,0x000000,255), C(TEXT_LINK,0x0066cc,255), C(TREE_LINES,0xa0a0a0,255),
  C(TOGGLE_OFF,0xcfcfcf,255), C(TOGGLE_ON,0x7fbf7f,255),
  C(FILE_DIR,0x0050a0,255), C(FILE_SONG_NATIVE,0x007000,255), C(FILE_SONG_IMPORT,0x2060a0,255), C(FILE_INSTR,0xa05000,255),
  C(FILE_AUDIO,0xa00000,255), C(FILE_AUDIO_COMPRESSED,0xa00040,255), C(FILE_WAVE,0x8000a0,255), C(FILE_VGM,0x707000,255),
  C(FILE_ZSM,0x707000,255), C(FILE_FONT,0x505050,255), C(FILE_OTHER,0x000000,255),
  C(ORDER_ROW_INDEX,0x000000,255), C(ORDER_ACTIVE,0x000000,255), C(ORDER_SELECTED,0x0060c0,255), C(ORDER_SIMILAR,0x505050,255), C(ORDER_INACTIVE,0x8c8c8c,255),
  C(CHANNEL_BG,0xe1e1e1,255), C(CHANNEL_FG,0x000000,255), C(CHANNEL_MUTED,0xb03030,255),
  C(EDITING,0xd04040,255), C(EDITING_CLONE,0xd08000,255), C(SONG_LOOP,0x00a000,255),
  C(PIANO_BACKGROUND,0xf0f0f0,255),
  C(CLOCK_TEXT,0x000000,255),
  C(LOGLEVEL_INFO,0x000000,255), C(LOGLEVEL_DEBUG,0x303080,255), C(LOGLEVEL_TRACE,0x606060,255),
  C(PLAYBACK_STAT,0x000000,255),
  {-1,0,0}
};

// ---------- FamiTracker: editor preto, notas verdes, linhas de compasso amarelas ----------
// (cores padrão do FamiTracker 0.4.6, ColorScheme.h)
static const RGSkinColor skinFamiTracker[]={
  C(PATTERN_BG,0x000000,255), C(CHANNEL_FG,0xe8e8e8,255),
  C(PATTERN_HI_1,0x101000,255), C(PATTERN_HI_2,0x202000,255),
  C(PATTERN_ACTIVE,0x00ff00,255), C(PATTERN_ACTIVE_HI1,0xf0f000,255), C(PATTERN_ACTIVE_HI2,0xffff60,255),
  C(PATTERN_INACTIVE,0x007000,255), C(PATTERN_INACTIVE_HI1,0x707000,255), C(PATTERN_INACTIVE_HI2,0x80802c,255),
  C(PATTERN_ROW_INDEX,0x00ff00,255), C(PATTERN_ROW_INDEX_HI1,0xf0f000,255), C(PATTERN_ROW_INDEX_HI2,0xffff60,255),
  C(PATTERN_INS,0x80ff80,255), C(PATTERN_INS_WARN,0xffff00,255), C(PATTERN_INS_ERROR,0xff4040,255),
  C(PATTERN_VOLUME_MAX,0x8080ff,255), C(PATTERN_VOLUME_HALF,0x8080ff,255), C(PATTERN_VOLUME_MIN,0x8080ff,255),
  C(PATTERN_EFFECT_INVALID,0xff4040,255), C(PATTERN_EFFECT_PITCH,0xff8080,255), C(PATTERN_EFFECT_VOLUME,0xff8080,255),
  C(PATTERN_EFFECT_PANNING,0xff8080,255), C(PATTERN_EFFECT_SONG,0xff8080,255), C(PATTERN_EFFECT_TIME,0xff8080,255),
  C(PATTERN_EFFECT_SPEED,0xff8080,255), C(PATTERN_EFFECT_SYS_PRIMARY,0xff8080,255), C(PATTERN_EFFECT_SYS_SECONDARY,0xff8080,255),
  C(PATTERN_EFFECT_MISC,0xff8080,255),
  C(PATTERN_CURSOR,0x808080,200), C(PATTERN_CURSOR_HOVER,0x909090,200), C(PATTERN_CURSOR_ACTIVE,0xa0a0a0,220),
  C(PATTERN_SELECTION,0x6000ff,110), C(PATTERN_SELECTION_HOVER,0x6000ff,140), C(PATTERN_SELECTION_ACTIVE,0x6000ff,170),
  C(PATTERN_PLAY_HEAD,0x500040,255), C(PATTERN_CURSOR_POS_INDICATOR,0x3060a0,255),
  C(OSC_BG1,0x000000,255), C(OSC_BG2,0x000000,255), C(OSC_BG3,0x000000,255), C(OSC_BG4,0x000000,255),
  C(OSC_BORDER,0x3060a0,255), C(OSC_WAVE,0x00ff00,255),
  {-1,0,0}
};

// ---------- OpenMPT: editor branco, colunas coloridas (padrão do OpenMPT) ----------
static const RGSkinColor skinOpenMPT[]={
  C(PATTERN_BG,0xffffff,255),
  C(PATTERN_HI_1,0xedf2ed,255), C(PATTERN_HI_2,0xd5e1d5,255),
  C(PATTERN_ACTIVE,0x000080,255), C(PATTERN_ACTIVE_HI1,0x000080,255), C(PATTERN_ACTIVE_HI2,0x000060,255),
  C(PATTERN_INACTIVE,0xa0a0a0,255), C(PATTERN_INACTIVE_HI1,0x909890,255), C(PATTERN_INACTIVE_HI2,0x808a80,255),
  C(PATTERN_ROW_INDEX,0x000000,255), C(PATTERN_ROW_INDEX_HI1,0x000080,255), C(PATTERN_ROW_INDEX_HI2,0x000080,255),
  C(PATTERN_INS,0x008080,255), C(PATTERN_INS_WARN,0xa06000,255), C(PATTERN_INS_ERROR,0xc00000,255),
  C(PATTERN_VOLUME_MAX,0x008000,255), C(PATTERN_VOLUME_HALF,0x008000,255), C(PATTERN_VOLUME_MIN,0x006000,255),
  C(PATTERN_EFFECT_INVALID,0xc00000,255), C(PATTERN_EFFECT_PITCH,0x808000,255), C(PATTERN_EFFECT_VOLUME,0x008000,255),
  C(PATTERN_EFFECT_PANNING,0x008080,255), C(PATTERN_EFFECT_SONG,0x800000,255), C(PATTERN_EFFECT_TIME,0x800000,255),
  C(PATTERN_EFFECT_SPEED,0x800000,255), C(PATTERN_EFFECT_SYS_PRIMARY,0x000080,255), C(PATTERN_EFFECT_SYS_SECONDARY,0x400080,255),
  C(PATTERN_EFFECT_MISC,0x404040,255),
  C(PATTERN_CURSOR,0x000080,70), C(PATTERN_CURSOR_HOVER,0x000080,90), C(PATTERN_CURSOR_ACTIVE,0x000080,110),
  C(PATTERN_SELECTION,0x000080,55), C(PATTERN_SELECTION_HOVER,0x000080,75), C(PATTERN_SELECTION_ACTIVE,0x000080,95),
  C(PATTERN_PLAY_HEAD,0xffff80,255), C(PATTERN_CURSOR_POS_INDICATOR,0x0078d7,255),
  C(OSC_BG1,0xffffff,255), C(OSC_BG2,0xffffff,255), C(OSC_BG3,0xf4f4f4,255), C(OSC_BG4,0xf4f4f4,255),
  C(OSC_BORDER,0xa0a0a0,255), C(OSC_WAVE,0x000080,255), C(OSC_GUIDE,0xc0c0c0,255), C(OSC_REF,0xa0a0a0,255),
  C(SAMPLE_BG,0xffffff,255), C(SAMPLE_FG,0x000080,255), C(SAMPLE_CENTER,0xc0c0c0,255), C(SAMPLE_GRID,0xe0e0e0,255),
  C(SAMPLE_TIME_BG,0xf0f0f0,255), C(SAMPLE_TIME_FG,0x000000,255),
  {-1,0,0}
};

#undef C

struct RGSkin {
  const char* id;
  const char* name;
  int base;                    // 0 cores do Furnace, 1 verde do Registro Gamer
  const RGSkinColor* colors[3];
  bool light;
  bool rounded;
  bool frameBorders;
  int mainFont;                // fonte embutida (6 = arquivo em mainPath)
  const char* mainPath;
  int mainSize;
  int patFont;
  const char* patPath;
  int patSize;
};

static const RGSkin rgSkins[]={
  {"registro","Registro Gamer (verde)",1,{NULL,NULL,NULL},false,true,false,6,"/fonts/Oxanium-Medium.ttf",16,0,"",18},
  {"studio","Chiptune Studio (azul-roxo)",0,{skinStudio,NULL,NULL},false,true,false,6,"/fonts/Oxanium-Medium.ttf",16,0,"",18},
  {"furnace","Furnace (original)",0,{NULL,NULL,NULL},false,true,false,0,"",18,0,"",18},
  {"famitracker","FamiTracker",0,{skinWindowsChrome,skinFamiTracker,NULL},true,false,true,1,"",14,6,"/fonts/DejaVuSansMono-Bold.ttf",14},
  {"openmpt","OpenMPT",0,{skinWindowsChrome,skinOpenMPT,NULL},true,false,true,1,"",14,3,"",14},
  {NULL,NULL,0,{NULL,NULL,NULL},false,false,false,0,NULL,0,0,NULL,0}
};

int FurnaceGUI::rgSkinCount() {
  int n=0;
  while (rgSkins[n].id) n++;
  return n;
}

const char* FurnaceGUI::rgSkinId(int i) {
  if (i<0 || i>=rgSkinCount()) return "";
  return rgSkins[i].id;
}

const char* FurnaceGUI::rgSkinName(int i) {
  if (i<0 || i>=rgSkinCount()) return "";
  return rgSkins[i].name;
}

String FurnaceGUI::rgCurrentSkin() {
#ifdef __EMSCRIPTEN__
  return e->getConfString("rgSkin","registro");
#else
  return e->getConfString("rgSkin","");
#endif
}

// pede a troca (feita no começo do próximo quadro, porque as fontes são refeitas)
void FurnaceGUI::rgRequestSkin(const String& id) {
  rgSkinPending=id;
}

bool FurnaceGUI::rgApplySkin(const String& id) {
  const RGSkin* sk=NULL;
  for (int i=0; rgSkins[i].id; i++) {
    if (id==rgSkins[i].id) sk=&rgSkins[i];
  }
  if (sk==NULL) return false;

  // cores: base + as da skin
  for (int i=0; i<GUI_COLOR_MAX; i++) {
    unsigned int def=guiColors[i].defaultColor;
    uiColors[i]=ImGui::ColorConvertU32ToFloat4((unsigned int)(sk->base==1?rgGreenColor(i,def):(int)def));
  }
  for (int k=0; k<3; k++) {
    const RGSkinColor* c=sk->colors[k];
    if (c==NULL) continue;
    for (; c->id>=0; c++) {
      uiColors[c->id]=ImVec4(
        (float)((c->rgb>>16)&0xff)/255.0f,
        (float)((c->rgb>>8)&0xff)/255.0f,
        (float)(c->rgb&0xff)/255.0f,
        (float)c->a/255.0f
      );
    }
  }

  // formato
  settings.guiColorsBase=sk->light?1:0;
  settings.basicColors=!sk->light; // nas skins claras os botões/abas têm cor própria
  settings.roundedWindows=sk->rounded;
  settings.roundedButtons=sk->rounded;
  settings.roundedMenus=sk->rounded;
  settings.roundedTabs=sk->rounded;
  settings.roundedScrollbars=sk->rounded;
  settings.frameBorders=sk->frameBorders;
  settings.guiColorsShading=0;

  // fontes
  settings.mainFont=sk->mainFont;
  settings.headFont=sk->mainFont;
  settings.mainFontPath=sk->mainPath;
  settings.headFontPath=(sk->mainFont==6)?String("/fonts/Oxanium-Bold.ttf"):String("");
  settings.mainFontSize=sk->mainSize;
  settings.patFont=sk->patFont;
  settings.patFontPath=sk->patPath;
  settings.patFontSize=sk->patSize;
  settings.headFontSize=MAX(16,sk->mainSize*27/16);

  e->setConf("rgSkin",id);
  writeConfig(e->getConfObject());
  e->saveConf();
  ImGui::GetIO().Fonts->Clear();
  applyUISettings();
  return true;
}
