const UTF8 = { getStringFromBytes(bytes, off, len) {
  try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes).subarray(off || 0, (off || 0) + (len == null ? bytes.length : len))); }
  catch (e) { return ''; } } };
export default UTF8;
