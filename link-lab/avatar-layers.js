/* ML3D Avatar por capas: piel, ojos y pelo recoloreables.
   Hojas 4x4 (columnas = frames 0..3; filas = down, up, left, right). Frame 32x48 (x1) o 64x96 (x2).
   Cada capa recoloreable usa colores "clave" (avatar.json -> keys) que se sustituyen por la paleta elegida.

   const av = new LayeredAvatar(canvas, AVATAR_JSON, 2);
   av.setLayer('base', baseImg); av.setLayer('eyes', eyesImg); av.setLayer('hair', hairImg);
   av.setColors('base', makeSkinPalette('#c68a5a', AVATAR_JSON.keys.skin));
   av.setColors('eyes', makeEyePalette('#5c1e22', null, AVATAR_JSON.keys.eyes));  // granate original
   av.setColors('hair', makeHairPalette('#d04a8a'));
   av.draw('down', frame);            // CSS: canvas { image-rendering: pixelated }
*/
const AV_DIR_ROW = { down: 0, up: 1, left: 2, right: 3 };

const hex2rgb = h => { const v = parseInt(h.replace('#', ''), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
function rgb2hls([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, l, 0];
  const s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, l, s];
}
function hls2rgb(h, l, s) {
  h = ((h % 1) + 1) % 1; l = Math.min(1, Math.max(0, l)); s = Math.min(1, Math.max(0, s));
  if (!s) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

/* Piel: desplaza la rampa original para que su tono medio (índice 1) pase a ser el color elegido. */
function makeSkinPalette(hex, keys, mid = 1) {
  const [hm, lm, sm] = rgb2hls(keys[mid]), [hn, ln, sn] = rgb2hls(hex2rgb(hex));
  return keys.map(k => {
    const [h, l, s] = rgb2hls(k);
    return hls2rgb(hn + (h - hm), Math.min(0.97, Math.max(0.02, ln + (l - lm) * (0.6 + 0.8 * ln))), sn * (s / Math.max(sm, 1e-3)));
  });
}
/* Ojos (estilo original): claves [ceja, pestaña, esclerótica, iris oscuro, iris, brillo, brillo gris].
   El iris va de casi negro (arriba) al color elegido (abajo), como en la base original. */
function makeEyePalette(irisHex, browHex, keys) {
  const iris = hex2rgb(irisHex), [h, l, s] = rgb2hls(iris);
  return [browHex ? hex2rgb(browHex) : keys[0], keys[1], keys[2], hls2rgb(h, Math.max(0.03, l * 0.28), s), iris, keys[5], keys[6]];
}
/* Pelo: 7 claves [contorno, tono1 (oscuro) ... tono6 (claro)]; el color elegido queda como tono medio. */
function makeHairPalette(hex, n = 7) {
  const [h, l, s] = rgb2hls(hex2rgb(hex)), lo = Math.max(0.05, l - 0.30), hi = Math.min(0.94, l + 0.24), t = n - 1;
  const out = [hls2rgb(h, Math.max(0.03, lo - 0.10), s * 0.8)];
  for (let i = 0; i < t; i++) out.push(hls2rgb(h, lo + (hi - lo) * i / (t - 1), s * (1 - 0.15 * i / (t - 1))));
  return out;
}

class LayeredAvatar {
  constructor(canvas, cfg, scale = 2) {
    this.canvas = canvas; this.cfg = cfg; this.images = {}; this.colors = {}; this.cache = {};
    this.setScale(scale);
  }
  setScale(s) {
    this.FW = 32 * s; this.FH = 48 * s;
    this.canvas.width = this.FW; this.canvas.height = this.FH;
    this.ctx = this.canvas.getContext('2d'); this.ctx.imageSmoothingEnabled = false; this.cache = {};
  }
  setLayer(layer, img) { if (img) this.images[layer] = img; else delete this.images[layer]; delete this.cache[layer]; }
  setColors(layer, colors) { this.colors[layer] = colors; delete this.cache[layer]; }
  _sheet(layer) {
    if (this.cache[layer]) return this.cache[layer];
    const img = this.images[layer], kind = this.cfg.recolor[layer], to = this.colors[layer];
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    if (kind && to) {
      const map = new Map(this.cfg.keys[kind].map((k, i) => [k.join(','), to[i]]));
      const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        if (!px[i + 3]) continue;
        const t = map.get(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
        if (t) { px[i] = t[0]; px[i + 1] = t[1]; px[i + 2] = t[2]; }
      }
      x.putImageData(d, 0, 0);
    }
    return (this.cache[layer] = c);
  }
  draw(dir, frame) {
    const { FW, FH, ctx } = this;
    ctx.clearRect(0, 0, FW, FH);
    for (const layer of this.cfg.layerOrder)
      if (this.images[layer]) ctx.drawImage(this._sheet(layer), frame * FW, AV_DIR_ROW[dir] * FH, FW, FH, 0, 0, FW, FH);
  }
}

/* Export para el lobby: avatar-final.js lo consume desde window. */
window.ML3DAvatarLayers = { LayeredAvatar, makeSkinPalette, makeEyePalette, makeHairPalette, AV_DIR_ROW };
