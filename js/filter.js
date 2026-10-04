/**
 * Tratamiento en el navegador para empujar una foto hacia una ilustración:
 * campos de color, trazos, tinta en los bordes y grano.
 * No llama a ningún servidor.
 */

export const CARD_W = 900;
export const CARD_H = 1350;
export const MARGIN_X = 54;
export const MARGIN_Y = 72;

const INNER_W = CARD_W - MARGIN_X * 2;
const INNER_H = CARD_H - MARGIN_Y * 2;
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

function grade(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const curve = (channel) => {
    const next = (channel - 0.5) * 1.18 + 0.5;
    return next < 0 ? 0 : next > 1 ? 1 : next;
  };

  r = curve(r);
  g = curve(g);
  b = curve(b);

  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sat = 1.42;
  r = luma + (r - luma) * sat;
  g = luma + (g - luma) * sat;
  b = luma + (b - luma) * sat;
  r = r < 0 ? 0 : r > 1 ? 1 : r;
  g = g < 0 ? 0 : g > 1 ? 1 : g;
  b = b < 0 ? 0 : b > 1 ? 1 : b;

  const shadow = 1 - smoothstep(0.05, 0.58, luma);
  const highlight = smoothstep(0.42, 0.95, luma);
  const shadowMix = shadow * 0.32;
  const highlightMix = highlight * 0.2;

  r = r * (1 - shadowMix) + 0.17 * shadowMix;
  g = g * (1 - shadowMix) + 0.07 * shadowMix;
  b = b * (1 - shadowMix) + 0.2 * shadowMix;
  r = r * (1 - highlightMix) + 1 * highlightMix;
  g = g * (1 - highlightMix) + 0.86 * highlightMix;
  b = b * (1 - highlightMix) + 0.64 * highlightMix;

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

  const pull = 0.22;
  red = red * (1 - pull) + nearR * pull;
  green = green * (1 - pull) + nearG * pull;
  blue = blue * (1 - pull) + nearB * pull;

  const step = 255 / 5;
  const quant = (channel) => Math.round(channel / step) * step;
  const poster = 0.26;
  red = red * (1 - poster) + quant(red) * poster;
  green = green * (1 - poster) + quant(green) * poster;
  blue = blue * (1 - poster) + quant(blue) * poster;

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

function paintStrokes(ctx, colors, fieldLum, w, h) {
  const passes = [
    { radius: 16, step: 15, alphaFlat: 0.48, alphaEdge: 0.2 },
    { radius: 7, step: 9, alphaFlat: 0.42, alphaEdge: 0.18 },
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
        const angle = flat ? -0.55 : Math.atan2(fieldLum[Math.min(h - 1, iy + 1) * w + ix] - fieldLum[Math.max(0, iy - 1) * w + ix], fieldLum[iy * w + Math.min(w - 1, ix + 1)] - fieldLum[iy * w + Math.max(0, ix - 1)]) + Math.PI / 2;
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

function applyWashes(ctx, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const teal = ctx.createRadialGradient(w * 0.12, h * 0.08, 8, w * 0.2, h * 0.12, w * 0.75);
  teal.addColorStop(0, "rgba(32, 118, 128, 0.7)");
  teal.addColorStop(1, "rgba(32, 118, 128, 0)");
  ctx.fillStyle = teal;
  ctx.fillRect(0, 0, w, h);

  const coral = ctx.createRadialGradient(w * 0.86, h * 0.9, 8, w * 0.72, h * 0.82, w * 0.8);
  coral.addColorStop(0, "rgba(186, 78, 58, 0.55)");
  coral.addColorStop(1, "rgba(186, 78, 58, 0)");
  ctx.fillStyle = coral;
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
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = paperFill(ctx);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function applyVignette(ctx, w, h) {
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.46, w * 0.2, w * 0.5, h * 0.48, w * 0.78);
  vignette.addColorStop(0, "rgba(48, 24, 28, 0)");
  vignette.addColorStop(1, "rgba(42, 22, 28, 0.28)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function applyBloom(ctx, source) {
  const glow = soften(source, 32);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.1;
  ctx.drawImage(glow, 0, 0, source.width, source.height);
  ctx.restore();
}

function applyInk(ctx, fieldLum, w, h) {
  const magnitude = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    const wobble = Math.round(Math.sin(y * 0.17) * 1.1);
    for (let x = 1; x < w - 1; x += 1) {
      const sx = Math.min(w - 2, Math.max(1, x + wobble));
      magnitude[y * w + x] = sobelMag(fieldLum, w, h, sx, y);
    }
  }

  const threshold = percentile(magnitude, 0.9);
  if (threshold < 0.05) return;

  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < magnitude.length; i += 1) {
    const strength = smoothstep(threshold, threshold + 0.38, magnitude[i]);
    alpha[i] = Math.round(strength * 210);
  }

  const thick = new Uint8ClampedArray(alpha);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const value = alpha[y * w + x];
      if (!value) continue;
      const soft = value * 0.55;
      const neighbors = [y * w + x + 1, y * w + x - 1, (y + 1) * w + x, (y - 1) * w + x];
      for (const index of neighbors) {
        if (thick[index] < soft) thick[index] = soft;
      }
    }
  }

  const ink = ctx.createImageData(w, h);
  for (let i = 0, p = 0; i < ink.data.length; i += 4, p += 1) {
    if (!thick[p]) continue;
    ink.data[i] = 36;
    ink.data[i + 1] = 24;
    ink.data[i + 2] = 22;
    ink.data[i + 3] = thick[p];
  }

  const layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  layer.getContext("2d").putImageData(ink, 0, 0);
  ctx.drawImage(layer, 0, 0);
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
  const medium = soften(work, 180);
  const base = ctx.getImageData(0, 0, WORK_W, WORK_H);
  const fieldData = fields.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, WORK_W, WORK_H);
  const mediumData = medium.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, WORK_W, WORK_H);
  const output = ctx.createImageData(WORK_W, WORK_H);
  const fieldLum = new Float32Array(WORK_W * WORK_H);

  for (let i = 0, p = 0; i < base.data.length; i += 4, p += 1) {
    const red = fieldData.data[i] * 0.52 + mediumData.data[i] * 0.32 + base.data[i] * 0.16;
    const green = fieldData.data[i + 1] * 0.52 + mediumData.data[i + 1] * 0.32 + base.data[i + 1] * 0.16;
    const blue = fieldData.data[i + 2] * 0.52 + mediumData.data[i + 2] * 0.32 + base.data[i + 2] * 0.16;
    const graded = grade(red, green, blue);
    const grain = (hash(p) % 25) - 12;
    output.data[i] = clamp(graded[0] + grain);
    output.data[i + 1] = clamp(graded[1] + grain);
    output.data[i + 2] = clamp(graded[2] + grain);
    output.data[i + 3] = 255;
    fieldLum[p] = (0.2126 * fieldData.data[i] + 0.7152 * fieldData.data[i + 1] + 0.0722 * fieldData.data[i + 2]) / 255;
  }

  ctx.putImageData(output, 0, 0);
  paintStrokes(ctx, output, fieldLum, WORK_W, WORK_H);
  applyWashes(ctx, WORK_W, WORK_H);
  applyPaper(ctx, WORK_W, WORK_H);
  applyVignette(ctx, WORK_W, WORK_H);
  applyBloom(ctx, work);
  applyInk(ctx, fieldLum, WORK_W, WORK_H);
  return work;
}

async function ensureFonts() {
  if (!document.fonts?.ready) return;
  await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1800))]);
}

function drawPrinterMark(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#2a241c";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(0, 12);
  ctx.stroke();
  ctx.restore();
}

function drawCorner(ctx, x, y, sx, sy) {
  ctx.beginPath();
  ctx.moveTo(x, y + sy * 16);
  ctx.lineTo(x, y);
  ctx.lineTo(x + sx * 16, y);
  ctx.stroke();
}

function drawFrame(ctx) {
  ctx.save();
  ctx.strokeStyle = "#2a241c";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16.5, 16.5, CARD_W - 33, CARD_H - 33);
  ctx.lineWidth = 2.25;
  ctx.strokeRect(MARGIN_X - 8, MARGIN_Y - 8, INNER_W + 16, INNER_H + 16);

  ctx.lineWidth = 1.5;
  const inset = 16;
  drawCorner(ctx, inset, inset, 1, 1);
  drawCorner(ctx, CARD_W - inset, inset, -1, 1);
  drawCorner(ctx, inset, CARD_H - inset, 1, -1);
  drawCorner(ctx, CARD_W - inset, CARD_H - inset, -1, -1);
  drawPrinterMark(ctx, CARD_W / 2, MARGIN_Y / 2);

  ctx.fillStyle = "#5e5348";
  ctx.font = '600 18px Fraunces, Palatino, "Palatino Linotype", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  try {
    ctx.letterSpacing = "0.28em";
  } catch {
    /* Algunos navegadores no espacian el texto del lienzo. */
  }
  ctx.fillText("DIXIT CARDS", CARD_W / 2, CARD_H - MARGIN_Y / 2);
  ctx.restore();
}

function composeCard(art) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#f4efe4";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.drawImage(art, MARGIN_X, MARGIN_Y, INNER_W, INNER_H);
  drawFrame(ctx);
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
  await ensureFonts();
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
  await ensureFonts();
  const art = document.createElement("canvas");
  art.width = INNER_W;
  art.height = INNER_H;
  paintSample(art.getContext("2d"), INNER_W, INNER_H);
  return canvasToPngBlob(composeCard(art));
}
