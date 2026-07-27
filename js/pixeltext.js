/* Kartenburg — shared pixel-bitmap text. A 3x5 (some glyphs wider) pixel font
 * drawn on tiny canvases and upscaled with image-rendering: pixelated, so
 * headings match the card sprites exactly. Elements with class .pixel-title
 * get their text replaced by letter sprites; add .wave for the slow letter
 * bob (data-scale and data-color tune size and ink). */

const PIX_FONT = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '011', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['111', '010', '010', '010', '110'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  O: ['111', '101', '101', '101', '111'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '010', '001'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  ' ': ['00', '00', '00', '00', '00'],
  '-': ['000', '000', '111', '000', '000'],
  '!': ['1', '1', '1', '0', '1'],
  '.': ['0', '0', '0', '0', '1'],
  ':': ['0', '1', '0', '1', '0'],
  "'": ['1', '1', '0', '0', '0'],
};

const PIX_SUIT = {
  hearts:   ['01010', '11111', '11111', '01110', '00100'],
  diamonds: ['00100', '01110', '11111', '01110', '00100'],
  spades:   ['00100', '01110', '11111', '11111', '00100'],
  clubs:    ['00100', '01110', '11111', '00100', '01110'],
};

function drawPix(ctx, rows, x, y, colors, rot) {
  const h = rows.length;
  for (let j = 0; j < h; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '0') continue;
      const color = colors[ch] || colors['1'];
      if (!color) continue;
      ctx.fillStyle = color;
      if (rot) ctx.fillRect(x + (row.length - 1 - i), y + (h - 1 - j), 1, 1);
      else ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

const pixtCache = new Map();

function pixtChar(ch, color) {
  const key = ch + '|' + color;
  if (pixtCache.has(key)) return pixtCache.get(key);
  const glyph = PIX_FONT[ch];
  const cv = document.createElement('canvas');
  cv.width = glyph[0].length;
  cv.height = 5;
  drawPix(cv.getContext('2d'), glyph, 0, 0, { 1: color });
  const url = cv.toDataURL();
  pixtCache.set(key, url);
  return url;
}

function pixelWordHTML(text, scale, color, wave) {
  let html = '<span class="px-word' + (wave ? ' wave' : '') + '" style="gap:' + scale + 'px">';
  Array.from(text.toUpperCase()).forEach((ch, i) => {
    const glyph = PIX_FONT[ch];
    if (!glyph) {
      html += '<span class="px-fallback" style="font-size:' + scale * 6 + 'px;--li:' + i + '">' + ch + '</span>';
      return;
    }
    html += '<img class="pxl" src="' + pixtChar(ch, color) + '" width="' + glyph[0].length * scale +
      '" height="' + 5 * scale + '" style="--li:' + i + '" alt="' + ch + '">';
  });
  return html + '</span>';
}

function applyPixelTitles(root) {
  (root || document).querySelectorAll('.pixel-title').forEach(el => {
    if (el.dataset.pixelized) return;
    el.dataset.pixelized = '1';
    const scale = +el.dataset.scale || 3;
    const color = el.dataset.color || '#d4a72c';
    el.innerHTML = pixelWordHTML(el.textContent.trim(), scale, color, el.classList.contains('wave'));
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyPixelTitles());
else applyPixelTitles();
