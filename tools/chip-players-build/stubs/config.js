// Configuração do Registro Gamer (substitui src/config do Chip Player JS)
export const API_BASE = 'about:blank';
export const CATALOG_PREFIX = '';
export const SOUNDFONT_URL_PATH = (self.RG_PLAYER_BASE || '') + 'soundfonts';
export const MAX_SAMPLE_RATE = 48000;
export const MAX_VOICES = 64;
export const REPLACE_STATE_ON_SEEK = false;
export const FORMATS = [];
export const SOUNDFONT_MOUNTPOINT = '/soundfonts';
export const SOUNDFONTS = [
  { label: 'User', items: [] },
  { label: 'Small Soundfonts', items: [ { label: 'GMGSx Plus', value: 'gmgsx-plus.sf2' } ] },
];
