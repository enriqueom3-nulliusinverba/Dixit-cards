/**
 * Tratamiento en el navegador para empujar una foto hacia una ilustración
 * de cuento: pintura al gouache (filtro Kuwahara), color de ensueño,
 * luz que se desborda, enfoque suave hacia los bordes y destellos.
 * No llama a ningún servidor.
 */

/** Carta de Dixit: 80 × 120 mm (2:3), ilustración a sangre y esquinas redondeadas de unos 3,5 mm. */
export const CARD_W = 1024;
export const CARD_H = 1536;
export const CARD_RADIUS = 46;

const INNER_W = CARD_W;
const INNER_H = CARD_H;
const WORK_W = 540;
const WORK_H = Math.round(WORK_W * (INNER_H / INNER_W));

const PALETTE = [
  [24, 44, 82],
  [58, 110, 148],
  [36, 140, 132],
  [226, 186, 96],
  [236, 154, 92],
  [214, 96, 74],
  [122, 86, 122],
  [42, 112, 78],
  [244, 236, 220],
  [92, 58, 44],
  [186, 64, 86],
  [232, 214, 186],
  [70, 48, 62],
  [250, 232, 196],
];

let paperPattern = null;

function hash(n) {
  n = (n + 0x6d2b79f5) | 0;
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return (n ^ (n >>> 14)) >>> 0;
}

function clamp(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function smoothstep(edge0, edge1, value) {
  const span = edge1 - edge0 || 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / span));
  return t * t * (3 - 2 * t);
}

function sourceSize(source) {
  return {
    w: source.videoWidth || source.naturalWidth || source.width,
    h: source.videoHeight || source.naturalHeight || source.height,
  };
}

function drawCover(ctx, source, dw, dh) {
  const { w: sw, h: sh } = sourceSize(source);
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (dw - w) / 2, (dh - h) / 2, w, h);
}

function soften(source, smallWidth) {
  const smallHeight = Math.max(1, Math.round(smallWidth * (source.height / source.width)));
  const small = document.createElement("canvas");
  small.width = smallWidth;
  small.height = smallHeight;
  const smallCtx = small.getContext("2d");
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(source, 0, 0, smallWidth, smallHeight);

  const big = document.createElement("canvas");
  big.width = source.width;
  big.height = source.height;
  const bigCtx = big.getContext("2d", { willReadFrequently: true });
  bigCtx.imageSmoothingEnabled = true;
  bigCtx.imageSmoothingQuality = "high";
  bigCtx.drawImage(small, 0, 0, source.width, source.height);
  return big;
}

/**
 * Filtro Kuwahara con imágenes integrales: cada píxel toma el color medio
 * del cuadrante más uniforme de su entorno. Une las zonas en manchas planas
 * de pintura y mantiene limpios los bordes.
 */
function kuwahara(imageData, w, h, radius) {
  const stride = w + 1;
  const size = stride * (h + 1);
  const sumR = new Float64Array(size);
  const sumG = new Float64Array(size);
  const sumB = new Float64Array(size);
  const sumL = new Float64Array(size);
  const sumL2 = new Float64Array(size);
  const src = imageData.data;

  for (let y = 0; y < h; y += 1) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowL = 0;
    let rowL2 = 0;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      rowR += r;
      rowG += g;
      rowB += b;
      rowL += l;
      rowL2 += l * l;
      const k = (y + 1) * stride + x + 1;
      sumR[k] = sumR[k - stride] + rowR;
      sumG[k] = sumG[k - stride] + rowG;
      sumB[k] = sumB[k - stride] + rowB;
      sumL[k] = sumL[k - stride] + rowL;
      sumL2[k] = sumL2[k - stride] + rowL2;
    }
  }

  const box = (table, x0, y0, x1, y1) =>
    table[(y1 + 1) * stride + x1 + 1] - table[y0 * stride + x1 + 1] - table[(y1 + 1) * stride + x0] + table[y0 * stride + x0];

  const out = new ImageData(w, h);
  const dst = out.data;
  for (let y = 0; y < h; y += 1) {
    const ya = Math.max(0, y - radius);
    const yb = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x += 1) {
      const xa = Math.max(0, x - radius);
      const xb = Math.min(w - 1, x + radius);

      let best = Infinity;
      let mr = 0;
      let mg = 0;
      let mb = 0;
      for (let q = 0; q < 4; q += 1) {
        const x0 = q & 1 ? x : xa;
        const x1 = q & 1 ? xb : x;
        const y0 = q & 2 ? y : ya;
        const y1 = q & 2 ? yb : y;
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        const meanL = box(sumL, x0, y0, x1, y1) / n;
        const variance = box(sumL2, x0, y0, x1, y1) / n - meanL * meanL;
        if (variance < best) {
          best = variance;
          mr = box(sumR, x0, y0, x1, y1) / n;
          mg = box(sumG, x0, y0, x1, y1) / n;
          mb = box(sumB, x0, y0, x1, y1) / n;
        }
      }

      const i = (y * w + x) * 4;
      dst[i] = mr;
      dst[i + 1] = mg;
      dst[i + 2] = mb;
      dst[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Color de ensueño: contraste suave, sombras que viran a violeta en lugar de
 * negro, luces cálidas de oro y una saturación alta pero sin pasarse.
 */
function grade(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const curve = (channel) => {
    const next = (channel - 0.5) * 1.12 + 0.5;
    return next < 0 ? 0 : next > 1 ? 1 : next;
  };

  r = curve(r);
  g = curve(g);
  b = curve(b);

  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = 1.36;
  r = luma + (r - luma) * sat;
  g = luma + (g - luma) * sat;
  b = luma + (b - luma) * sat;
  r = r < 0 ? 0 : r > 1 ? 1 : r;
  g = g < 0 ? 0 : g > 1 ? 1 : g;
  b = b < 0 ? 0 : b > 1 ? 1 : b;

  const shadow = 1 - smoothstep(0.04, 0.55, luma);
  const highlight = smoothstep(0.45, 0.95, luma);
  const shadowMix = shadow * 0.42;
  const highlightMix = highlight * 0.26;

  r = r * (1 - shadowMix) + 0.2 * shadowMix;
  g = g * (1 - shadowMix) + 0.1 * shadowMix;
  b = b * (1 - shadowMix) + 0.32 * shadowMix;
  r = r * (1 - highlightMix) + 1 * highlightMix;
  g = g * (1 - highlightMix) + 0.88 * highlightMix;
  b = b * (1 - highlightMix) + 0.62 * highlightMix;

  let red = r * 255;
  let green = g * 255;
  let blue = b * 255;

  let best = Infinity;
  let nearR = red;
  let nearG = green;
  let nearB = blue;
  for (const color of PALETTE) {
    const dr = red - color[0];
    const dg = green - color[1];
    const db = blue - color[2];
    const distance = dr * dr + dg * dg + db * db;
    if (distance < best) {
      best = distance;
      nearR = color[0];
      nearG = color[1];
      nearB = color[2];
    }
  }

  const pull = 0.14;
  red = red * (1 - pull) + nearR * pull;
  green = green * (1 - pull) + nearG * pull;
  blue = blue * (1 - pull) + nearB * pull;

  return [clamp(red), clamp(green), clamp(blue)];
}

function sobelMag(lum, w, h, x, y) {
  if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) return 0;
  const at = (yy, xx) => lum[yy * w + xx];
  const gx =
    -at(y - 1, x - 1) +
    at(y - 1, x + 1) -
    2 * at(y, x - 1) +
    2 * at(y, x + 1) -
    at(y + 1, x - 1) +
    at(y + 1, x + 1);
  const gy =
    -at(y - 1, x - 1) -
    2 * at(y - 1, x) -
    at(y - 1, x + 1) +
    at(y + 1, x - 1) +
    2 * at(y + 1, x) +
    at(y + 1, x + 1);
  return Math.hypot(gx, gy);
}

function percentile(values, ratio) {
  const sample = [];
  for (let i = 0; i < values.length; i += 23) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(ratio * (sample.length - 1)))] || 0;
}

/** Pinceladas largas que siguen el contorno de las formas: dan la textura de pincel. */
function paintStrokes(ctx, colors, fieldLum, w, h) {
  const passes = [
    { radius: 15, step: 16, alphaFlat: 0.16, alphaEdge: 0.08 },
    { radius: 6, step: 10, alphaFlat: 0.14, alphaEdge: 0.07 },
  ];

  ctx.save();
  ctx.lineCap = "round";
  for (const pass of passes) {
    ctx.lineWidth = pass.radius * 0.85;
    for (let y = pass.step * 0.5; y < h; y += pass.step) {
      for (let x = pass.step * 0.5; x < w; x += pass.step) {
        const jx = Math.min(w - 1, Math.max(0, x + (hash((y * w + x) | 0) % pass.step) - pass.step / 2));
        const jy = Math.min(h - 1, Math.max(0, y + (hash((x * 13 + y) | 0) % pass.step) - pass.step / 2));
        const ix = jx | 0;
        const iy = jy | 0;
        const pixel = (iy * w + ix) * 4;
        const edge = sobelMag(fieldLum, w, h, ix, iy);
        const flat = edge < 0.42;
        const angle = flat
          ? -0.55
          : Math.atan2(
              fieldLum[Math.min(h - 1, iy + 1) * w + ix] - fieldLum[Math.max(0, iy - 1) * w + ix],
              fieldLum[iy * w + Math.min(w - 1, ix + 1)] - fieldLum[iy * w + Math.max(0, ix - 1)],
            ) +
            Math.PI / 2;
        const len = pass.radius * (flat ? 2.15 : 1.05);
        ctx.globalAlpha = flat ? pass.alphaFlat : pass.alphaEdge;
        ctx.strokeStyle = `rgb(${colors.data[pixel] | 0}, ${colors.data[pixel + 1] | 0}, ${colors.data[pixel + 2] | 0})`;
        ctx.beginPath();
        ctx.moveTo(jx - Math.cos(angle) * len, jy - Math.sin(angle) * len);
        ctx.lineTo(jx + Math.cos(angle) * len, jy + Math.sin(angle) * len);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** Lavados de color: violeta frío arriba a la izquierda, ámbar cálido abajo a la derecha. */
function applyWashes(ctx, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const violet = ctx.createRadialGradient(w * 0.1, h * 0.06, 8, w * 0.2, h * 0.14, w * 0.85);
  violet.addColorStop(0, "rgba(96, 74, 170, 0.7)");
  violet.addColorStop(1, "rgba(96, 74, 170, 0)");
  ctx.fillStyle = violet;
  ctx.fillRect(0, 0, w, h);

  const amber = ctx.createRadialGradient(w * 0.88, h * 0.92, 8, w * 0.7, h * 0.8, w * 0.85);
  amber.addColorStop(0, "rgba(236, 150, 84, 0.6)");
  amber.addColorStop(1, "rgba(236, 150, 84, 0)");
  ctx.fillStyle = amber;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function paperFill(ctx) {
  if (!paperPattern) {
    const tile = document.createElement("canvas");
    tile.width = 128;
    tile.height = 128;
    const tileCtx = tile.getContext("2d");
    const image = tileCtx.createImageData(128, 128);
    for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
      const speck = hash(p + 19) % 41 === 0;
      const tone = speck ? 168 : 228 + (hash(p) % 24);
      image.data[i] = tone;
      image.data[i + 1] = tone - 3;
      image.data[i + 2] = tone - 8;
      image.data[i + 3] = 255;
    }
    tileCtx.putImageData(image, 0, 0);
    paperPattern = ctx.createPattern(tile, "repeat");
  }
  return paperPattern;
}

function applyPaper(ctx, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = paperFill(ctx);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function applyVignette(ctx, w, h) {
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.46, w * 0.25, w * 0.5, h * 0.48, w * 0.82);
  vignette.addColorStop(0, "rgba(40, 24, 70, 0)");
  vignette.addColorStop(1, "rgba(34, 20, 64, 0.34)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Luz que se desborda: las zonas claras se difuminan mucho y se suman con
 * "screen", como el halo de una ilustración con luz propia.
 */
function applyGlow(ctx, source) {
  const w = source.width;
  const h = source.height;
  const bright = document.createElement("canvas");
  bright.width = w;
  bright.height = h;
  const brightCtx = bright.getContext("2d", { willReadFrequently: true });
  brightCtx.drawImage(source, 0, 0);
  const data = brightCtx.getImageData(0, 0, w, h);
  for (let i = 0; i < data.data.length; i += 4) {
    const luma = (0.2126 * data.data[i] + 0.7152 * data.data[i + 1] + 0.0722 * data.data[i + 2]) / 255;
    const keep = smoothstep(0.55, 0.9, luma);
    data.data[i] *= keep;
    data.data[i + 1] *= keep;
    data.data[i + 2] *= keep;
  }
  brightCtx.putImageData(data, 0, 0);

  const wide = soften(bright, 22);
  const tight = soften(bright, 70);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.4;
  ctx.drawImage(wide, 0, 0, w, h);
  ctx.globalAlpha = 0.2;
  ctx.drawImage(tight, 0, 0, w, h);
  ctx.restore();
}

/** Enfoque suave hacia los bordes, como un lienzo con el centro más nítido. */
function applySoftFocus(ctx, source) {
  const w = source.width;
  const h = source.height;
  const blurred = soften(source, 170);
  const bctx = blurred.getContext("2d");
  bctx.globalCompositeOperation = "destination-in";
  const mask = bctx.createRadialGradient(w * 0.5, h * 0.48, w * 0.42, w * 0.5, h * 0.5, w * 1.05);
  mask.addColorStop(0, "rgba(0, 0, 0, 0)");
  mask.addColorStop(1, "rgba(0, 0, 0, 0.5)");
  bctx.fillStyle = mask;
  bctx.fillRect(0, 0, w, h);
  ctx.drawImage(blurred, 0, 0);
}

/** Línea fina en tono ciruela solo en los contornos más marcados. Sin negro duro. */
function applyInk(ctx, fieldLum, w, h) {
  const magnitude = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    const wobble = Math.round(Math.sin(y * 0.17) * 1.1);
    for (let x = 1; x < w - 1; x += 1) {
      const sx = Math.min(w - 2, Math.max(1, x + wobble));
      magnitude[y * w + x] = sobelMag(fieldLum, w, h, sx, y);
    }
  }

  const threshold = percentile(magnitude, 0.94);
  if (threshold < 0.05) return;

  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < magnitude.length; i += 1) {
    const strength = smoothstep(threshold, threshold + 0.45, magnitude[i]);
    alpha[i] = Math.round(strength * 120);
  }

  const thick = new Uint8ClampedArray(alpha);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const value = alpha[y * w + x];
      if (!value) continue;
      const soft = value * 0.5;
      const neighbors = [y * w + x + 1, y * w + x - 1, (y + 1) * w + x, (y - 1) * w + x];
      for (const index of neighbors) {
        if (thick[index] < soft) thick[index] = soft;
      }
    }
  }

  const ink = ctx.createImageData(w, h);
  for (let i = 0, p = 0; i < ink.data.length; i += 4, p += 1) {
    if (!thick[p]) continue;
    ink.data[i] = 52;
    ink.data[i + 1] = 30;
    ink.data[i + 2] = 72;
    ink.data[i + 3] = thick[p];
  }

  const layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  layer.getContext("2d").putImageData(ink, 0, 0);
  ctx.drawImage(layer, 0, 0);
}

/** Destellos de luz sobre los puntos más brillantes: motas suaves y unas pocas estrellas. */
function applySparkles(ctx, fieldLum, w, h) {
  const cell = 54;
  const spots = [];
  for (let cy = 0; cy < h; cy += cell) {
    for (let cx = 0; cx < w; cx += cell) {
      let best = 0;
      let bx = cx;
      let by = cy;
      for (let y = cy; y < Math.min(h, cy + cell); y += 3) {
        for (let x = cx; x < Math.min(w, cx + cell); x += 3) {
          const value = fieldLum[y * w + x];
          if (value > best) {
            best = value;
            bx = x;
            by = y;
          }
        }
      }
      if (best > 0.72) spots.push({ x: bx, y: by, value: best });
    }
  }

  spots.sort((a, b) => b.value - a.value);
  const chosen = spots.slice(0, 22);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  chosen.forEach((spot, index) => {
    const seed = hash(Math.round(spot.x * 31 + spot.y * 17));
    const radius = 3 + (seed % 7);
    const glow = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, radius * 2.6);
    glow.addColorStop(0, "rgba(255, 238, 190, 0.85)");
    glow.addColorStop(0.35, "rgba(255, 214, 150, 0.32)");
    glow.addColorStop(1, "rgba(255, 214, 150, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();

    if (index < 5) {
      const arm = radius * 3.4;
      ctx.strokeStyle = "rgba(255, 244, 214, 0.75)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(spot.x - arm, spot.y);
      ctx.lineTo(spot.x + arm, spot.y);
      ctx.moveTo(spot.x, spot.y - arm);
      ctx.lineTo(spot.x, spot.y + arm);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function illustrateWork(source) {
  const work = document.createElement("canvas");
  work.width = WORK_W;
  work.height = WORK_H;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawCover(ctx, source, WORK_W, WORK_H);

  const fields = soften(work, 68);
  const medium = soften(work, 200);
  const base = ctx.getImageData(0, 0, WORK_W, WORK_H);
  const fieldData = fields.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, WORK_W, WORK_H);
  const mediumData = medium.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, WORK_W, WORK_H);

  const mixed = new ImageData(WORK_W, WORK_H);
  const fieldLum = new Float32Array(WORK_W * WORK_H);
  for (let i = 0, p = 0; i < base.data.length; i += 4, p += 1) {
    mixed.data[i] = fieldData.data[i] * 0.12 + mediumData.data[i] * 0.28 + base.data[i] * 0.6;
    mixed.data[i + 1] = fieldData.data[i + 1] * 0.12 + mediumData.data[i + 1] * 0.28 + base.data[i + 1] * 0.6;
    mixed.data[i + 2] = fieldData.data[i + 2] * 0.12 + mediumData.data[i + 2] * 0.28 + base.data[i + 2] * 0.6;
    mixed.data[i + 3] = 255;
    fieldLum[p] = (0.2126 * fieldData.data[i] + 0.7152 * fieldData.data[i + 1] + 0.0722 * fieldData.data[i + 2]) / 255;
  }

  const painted = kuwahara(mixed, WORK_W, WORK_H, 3);
  const output = ctx.createImageData(WORK_W, WORK_H);
  for (let i = 0, p = 0; i < painted.data.length; i += 4, p += 1) {
    const graded = grade(painted.data[i], painted.data[i + 1], painted.data[i + 2]);
    const grain = (hash(p) % 17) - 8;
    output.data[i] = clamp(graded[0] + grain);
    output.data[i + 1] = clamp(graded[1] + grain);
    output.data[i + 2] = clamp(graded[2] + grain);
    output.data[i + 3] = 255;
  }

  ctx.putImageData(output, 0, 0);
  paintStrokes(ctx, output, fieldLum, WORK_W, WORK_H);
  applyWashes(ctx, WORK_W, WORK_H);
  applyGlow(ctx, work);
  applySoftFocus(ctx, work);
  applyInk(ctx, fieldLum, WORK_W, WORK_H);
  applySparkles(ctx, fieldLum, WORK_W, WORK_H);
  applyPaper(ctx, WORK_W, WORK_H);
  applyVignette(ctx, WORK_W, WORK_H);
  return work;
}


function composeCard(art) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.beginPath();
  ctx.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
  ctx.clip();
  ctx.drawImage(art, 0, 0, CARD_W, CARD_H);
  return canvas;
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("No se ha podido crear el PNG"));
      else resolve(blob);
    }, "image/png");
  });
}

export async function illustrateSource(source) {
  return composeCard(illustrateWork(source));
}

function hill(ctx, base, color, amplitude, w, h) {
  ctx.beginPath();
  ctx.moveTo(0, base);
  for (let x = 0; x <= w; x += 10) {
    const y = base - Math.sin(x * 0.008 + amplitude) * amplitude - Math.sin(x * 0.021) * amplitude * 0.35;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function cypress(ctx, x, y, width, height) {
  ctx.save();
  ctx.fillStyle = "#14352d";
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.quadraticCurveTo(x - width, y + height * 0.55, x - width * 0.28, y + height * 0.18);
  ctx.quadraticCurveTo(x - width * 0.08, y, x, y - height * 0.02);
  ctx.quadraticCurveTo(x + width * 0.08, y, x + width * 0.28, y + height * 0.18);
  ctx.quadraticCurveTo(x + width, y + height * 0.55, x, y + height);
  ctx.fill();
  ctx.fillStyle = "rgba(86, 140, 112, 0.35)";
  ctx.beginPath();
  ctx.ellipse(x - width * 0.08, y + height * 0.38, width * 0.16, height * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function house(ctx, x, y, width, height) {
  ctx.fillStyle = "#3c2a32";
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = "#2a1c24";
  ctx.beginPath();
  ctx.moveTo(x - width * 0.12, y + height * 0.02);
  ctx.lineTo(x + width * 0.5, y - height * 0.42);
  ctx.lineTo(x + width * 1.12, y + height * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f2d08a";
  ctx.fillRect(x + width * 0.16, y + height * 0.22, width * 0.22, height * 0.22);
  ctx.fillStyle = "rgba(255, 214, 140, 0.28)";
  ctx.beginPath();
  ctx.arc(x + width * 0.27, y + height * 0.33, width * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1214";
  ctx.fillRect(x + width * 0.58, y + height * 0.48, width * 0.2, height * 0.52);
}

function cup(ctx, x, y, size) {
  ctx.fillStyle = "rgba(48, 24, 18, 0.22)";
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.46, size * 0.55, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(x - size, y, x + size, y);
  body.addColorStop(0, "#143e4e");
  body.addColorStop(0.48, "#2f8eab");
  body.addColorStop(1, "#123644");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.4, y - size * 0.12);
  ctx.lineTo(x - size * 0.3, y + size * 0.4);
  ctx.quadraticCurveTo(x, y + size * 0.52, x + size * 0.3, y + size * 0.4);
  ctx.lineTo(x + size * 0.4, y - size * 0.12);
  ctx.quadraticCurveTo(x, y + size * 0.02, x - size * 0.4, y - size * 0.12);
  ctx.fill();

  ctx.fillStyle = "#e7f4f4";
  ctx.beginPath();
  ctx.ellipse(x, y - size * 0.12, size * 0.4, size * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a5566";
  ctx.beginPath();
  ctx.ellipse(x, y - size * 0.12, size * 0.26, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1c6274";
  ctx.lineWidth = Math.max(3, size * 0.07);
  ctx.beginPath();
  ctx.arc(x + size * 0.42, y + size * 0.08, size * 0.16, -1.15, 1.15);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 248, 240, 0.7)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const sx = x - size * 0.14 + i * size * 0.14;
    ctx.beginPath();
    ctx.moveTo(sx, y - size * 0.28);
    ctx.bezierCurveTo(sx + 10, y - size * 0.46, sx - 8, y - size * 0.62, sx + 2, y - size * 0.82);
    ctx.stroke();
  }
}

function bottle(ctx, x, y, size) {
  ctx.fillStyle = "rgba(186, 214, 168, 0.55)";
  ctx.strokeStyle = "rgba(28, 70, 58, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.16, y);
  ctx.lineTo(x - size * 0.2, y + size * 0.55);
  ctx.quadraticCurveTo(x, y + size * 0.68, x + size * 0.2, y + size * 0.55);
  ctx.lineTo(x + size * 0.16, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(x - size * 0.06, y - size * 0.28, size * 0.12, size * 0.3);
  ctx.strokeRect(x - size * 0.06, y - size * 0.28, size * 0.12, size * 0.3);

  ctx.strokeStyle = "#1f6b42";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.2);
  ctx.quadraticCurveTo(x + size * 0.2, y - size * 0.55, x + size * 0.05, y - size * 0.9);
  ctx.stroke();
  ctx.fillStyle = "#2f8a4e";
  ctx.beginPath();
  ctx.ellipse(x + size * 0.16, y - size * 0.72, size * 0.16, size * 0.08, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#7fbf62";
  ctx.beginPath();
  ctx.ellipse(x - size * 0.02, y - size * 0.84, size * 0.14, size * 0.07, 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d4533e";
  ctx.beginPath();
  ctx.arc(x + size * 0.08, y - size * 0.98, size * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function lemon(ctx, x, y, size) {
  ctx.fillStyle = "#e2b423";
  ctx.beginPath();
  ctx.ellipse(x, y, size * 0.28, size * 0.2, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f3d56a";
  ctx.beginPath();
  ctx.ellipse(x - size * 0.06, y - size * 0.04, size * 0.1, size * 0.06, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2c7a45";
  ctx.beginPath();
  ctx.ellipse(x + size * 0.18, y - size * 0.12, size * 0.1, size * 0.05, 0.7, 0, Math.PI * 2);
  ctx.fill();
}

function moth(ctx, x, y, size) {
  ctx.fillStyle = "rgba(214, 126, 138, 0.9)";
  ctx.beginPath();
  ctx.ellipse(x - size * 0.16, y, size * 0.18, size * 0.1, -0.5, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.16, y, size * 0.18, size * 0.1, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2a211c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.08);
  ctx.lineTo(x, y + size * 0.1);
  ctx.stroke();
}

function paintSample(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.78);
  sky.addColorStop(0, "#1a315c");
  sky.addColorStop(0.42, "#b85a66");
  sky.addColorStop(0.74, "#f0b27a");
  sky.addColorStop(1, "#f6d7a8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sunX = w * 0.73;
  const sunY = h * 0.2;
  const glow = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, w * 0.48);
  glow.addColorStop(0, "rgba(255, 236, 196, 0.95)");
  glow.addColorStop(0.28, "rgba(255, 190, 130, 0.35)");
  glow.addColorStop(1, "rgba(255, 190, 130, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fff3d4";
  ctx.beginPath();
  ctx.arc(sunX, sunY, w * 0.085, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 244, 220, 0.85)";
  for (const [px, py] of [
    [0.12, 0.07],
    [0.24, 0.13],
    [0.4, 0.05],
    [0.53, 0.1],
    [0.9, 0.06],
  ]) {
    ctx.beginPath();
    ctx.arc(w * px, h * py, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255, 236, 220, 0.28)";
  ctx.beginPath();
  ctx.ellipse(w * 0.22, h * 0.16, w * 0.16, h * 0.035, 0, 0, Math.PI * 2);
  ctx.ellipse(w * 0.3, h * 0.15, w * 0.1, h * 0.028, 0, 0, Math.PI * 2);
  ctx.fill();

  hill(ctx, h * 0.58, "#7d9484", 28, w, h);
  hill(ctx, h * 0.66, "#2f5d4c", 36, w, h);
  hill(ctx, h * 0.74, "#1b3c34", 18, w, h);

  cypress(ctx, w * 0.16, h * 0.4, w * 0.055, h * 0.28);
  cypress(ctx, w * 0.28, h * 0.46, w * 0.04, h * 0.2);
  house(ctx, w * 0.48, h * 0.5, w * 0.16, h * 0.16);

  ctx.strokeStyle = "#241c18";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.62, h * 0.28);
  ctx.quadraticCurveTo(w * 0.7, h * 0.3, w * 0.66, h * 0.34);
  ctx.quadraticCurveTo(w * 0.6, h * 0.33, w * 0.64, h * 0.3);
  ctx.stroke();

  const ledge = ctx.createLinearGradient(0, h * 0.72, 0, h);
  ledge.addColorStop(0, "#d7a07a");
  ledge.addColorStop(0.08, "#8a4638");
  ledge.addColorStop(1, "#5c2e2a");
  ctx.fillStyle = ledge;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.78);
  ctx.quadraticCurveTo(w * 0.5, h * 0.7, w, h * 0.76);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 226, 196, 0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.785);
  ctx.quadraticCurveTo(w * 0.5, h * 0.708, w, h * 0.765);
  ctx.stroke();

  bottle(ctx, w * 0.24, h * 0.7, w * 0.28);
  lemon(ctx, w * 0.46, h * 0.8, w * 0.34);
  cup(ctx, w * 0.68, h * 0.74, w * 0.22);
  moth(ctx, w * 0.84, h * 0.68, w * 0.16);
}

export async function createSampleBlob() {
  const art = document.createElement("canvas");
  art.width = INNER_W;
  art.height = INNER_H;
  paintSample(art.getContext("2d"), INNER_W, INNER_H);
  return canvasToPngBlob(composeCard(art));
}

function backFlourish(ctx, cx, y, half, color, lineWidth) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 22, y);
    ctx.bezierCurveTo(cx + side * half * 0.35, y - 34, cx + side * half * 0.62, y + 36, cx + side * half * 0.86, y - 6);
    ctx.bezierCurveTo(cx + side * half * 0.96, y - 22, cx + side * half * 1.04, y - 4, cx + side * half * 0.97, y + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + side * half * 0.97, y + 8, lineWidth * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx, y - 11);
  ctx.lineTo(cx + 11, y);
  ctx.lineTo(cx, y + 11);
  ctx.lineTo(cx - 11, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Reverso propio, en el aire del reverso de una baraja de cuento: acuarela cálida
 * de naranjas y rojos, borde crema y un nombre con florituras en el centro.
 */
export async function createBackBlob() {
  try {
    await Promise.race([
      document.fonts.load('650 120px Fraunces'),
      new Promise((resolve) => setTimeout(resolve, 1800)),
    ]);
  } catch {
    /* Si la fuente no carga, se usa la de reserva. */
  }

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const border = 30;
  const inner = CARD_RADIUS - 14;
  const cx = CARD_W / 2;
  const cy = CARD_H / 2;

  ctx.beginPath();
  ctx.roundRect(0, 0, CARD_W, CARD_H, CARD_RADIUS);
  ctx.clip();
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(border, border, CARD_W - border * 2, CARD_H - border * 2, inner);
  ctx.clip();

  ctx.fillStyle = "#df5f3d";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const tints = ["240, 137, 74", "216, 69, 79", "246, 178, 110", "194, 58, 88", "250, 150, 90", "222, 96, 60"];
  for (let i = 0; i < 46; i += 1) {
    const seed = hash(i * 211 + 7);
    const x = seed % CARD_W;
    const y = hash(seed) % CARD_H;
    const radius = 160 + (hash(seed + 3) % 300);
    const tint = tints[hash(seed + 8) % tints.length];
    const blob = ctx.createRadialGradient(x, y, 0, x, y, radius);
    blob.addColorStop(0, `rgba(${tint}, 0.5)`);
    blob.addColorStop(1, `rgba(${tint}, 0)`);
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }

  ctx.lineCap = "round";
  for (let i = 0; i < 34; i += 1) {
    const seed = hash(i * 619 + 31);
    const x = seed % CARD_W;
    const y = hash(seed + 1) % CARD_H;
    const span = 220 + (hash(seed + 2) % 380);
    const turn = (hash(seed + 4) % 2 ? 1 : -1) * (80 + (hash(seed + 6) % 160));
    const light = i % 3 !== 0;
    ctx.strokeStyle = light ? "rgba(255, 214, 160, 0.17)" : "rgba(130, 28, 60, 0.15)";
    ctx.lineWidth = 18 + (hash(seed + 12) % 64);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + span * 0.3, y - turn, x + span * 0.7, y + turn, x + span, y);
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.strokeStyle = "rgba(255, 236, 200, 0.24)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y + 22);
      ctx.bezierCurveTo(x + span * 0.3, y + 22 - turn, x + span * 0.7, y + 22 + turn, x + span, y + 22);
      ctx.stroke();
    }
  }

  const edge = ctx.createRadialGradient(cx, cy, CARD_W * 0.35, cx, cy, CARD_H * 0.62);
  edge.addColorStop(0, "rgba(120, 20, 50, 0)");
  edge.addColorStop(1, "rgba(120, 20, 50, 0.42)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 360);
  halo.addColorStop(0, "rgba(255, 232, 180, 0.55)");
  halo.addColorStop(1, "rgba(255, 232, 180, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = paperFill(ctx);
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  ctx.strokeStyle = "rgba(190, 120, 90, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(border, border, CARD_W - border * 2, CARD_H - border * 2, inner);
  ctx.stroke();

  const moon = document.createElement("canvas");
  moon.width = 160;
  moon.height = 160;
  const mctx = moon.getContext("2d");
  mctx.fillStyle = "#fff0c4";
  mctx.beginPath();
  mctx.arc(80, 80, 56, 0, Math.PI * 2);
  mctx.fill();
  mctx.globalCompositeOperation = "destination-out";
  mctx.beginPath();
  mctx.arc(104, 66, 52, 0, Math.PI * 2);
  mctx.fill();
  ctx.save();
  ctx.shadowColor = "rgba(110, 24, 50, 0.5)";
  ctx.shadowBlur = 16;
  ctx.translate(cx, cy - 215);
  ctx.rotate(-0.35);
  ctx.drawImage(moon, -64, -64, 128, 128);
  ctx.restore();

  backFlourish(ctx, cx, cy - 120, 250, "rgba(255, 236, 190, 0.9)", 4);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.font = '650 205px Fraunces, "Iowan Old Style", Palatino, serif';
  ctx.shadowColor = "rgba(90, 14, 40, 0.5)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 8;
  ctx.strokeStyle = "#fff0cf";
  ctx.lineWidth = 14;
  ctx.strokeText("Dixit", cx, cy + 15);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = "#5a1428";
  ctx.fillText("Dixit", cx, cy + 15);

  ctx.font = '560 76px Fraunces, "Iowan Old Style", Palatino, serif';
  try {
    ctx.letterSpacing = "0.2em";
  } catch {
    /* Algunos navegadores no espacian el texto del lienzo. */
  }
  ctx.shadowColor = "rgba(90, 14, 40, 0.5)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = "#fff0cf";
  ctx.fillText("cards", cx, cy + 155);
  ctx.shadowColor = "transparent";

  backFlourish(ctx, cx, cy + 240, 250, "rgba(255, 236, 190, 0.9)", 4);

  return canvasToPngBlob(canvas);
}
