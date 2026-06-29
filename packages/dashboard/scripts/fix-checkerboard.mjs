import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isColored(r, g, b) {
  // purple (morado)
  if (b > 100 && r > 60 && g < 200 && b > r + 15) return true;
  // green (circulo)
  if (g > 110 && r < 200 && b < 140 && g > r + 15) return true;
  // red (corazon/cuadrado)
  if (r > 160 && g < 120 && b < 120) return true;
  // yellow (triangulo)
  if (r > 180 && g > 140 && b < 100) return true;
  // blue (estrella)
  if (b > 160 && r < 160 && g > 100) return true;
  return false;
}

function isDark(r, g, b) {
  return r < 70 && g < 70 && b < 70;
}

function isBackground(r, g, b) {
  const neutral = Math.abs(r - g) < 18 && Math.abs(g - b) < 18;
  if (!neutral) return false;
  return r >= 170;
}

export async function fixCheckerboard(inputPath, outputPath) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const mask = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isColored(data[i], data[i + 1], data[i + 2])) mask[y * w + x] = 1;
    }
  }

  for (let pass = 0; pass < 200; pass++) {
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const idx = ny * w + nx;
          if (mask[idx]) continue;
          const i = idx * 4;
          if (isDark(data[i], data[i + 1], data[i + 2])) {
            mask[idx] = 1;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (mask[y * w + x]) {
        data[i + 3] = 255;
      } else if (isBackground(r, g, b) || isDark(r, g, b)) {
        data[i + 3] = 0;
      } else {
        data[i + 3] = 0;
      }
    }
  }

  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toFile(outputPath);

  console.log("Fixed:", outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targets = process.argv.slice(2);
  const files =
    targets.length > 0
      ? targets
      : [
          path.join(__dirname, "../public/agents/morado-sentado.png"),
          path.resolve(__dirname, "../../landing/public/morado-sentado.png"),
        ];

  for (const file of files) {
    await fixCheckerboard(file, file);
  }
}
