import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isForeground(r, g, b) {
  if (r > 180 && g > 130 && b > 180) return true;
  if (r > 140 && g < 120 && b < 120 && r > g + 20) return true;
  if (g > 130 && r < 150 && b < 150 && g > r + 20) return true;
  return false;
}

function isGrayBg(r, g, b) {
  return Math.abs(r - g) < 22 && Math.abs(g - b) < 22 && r >= 35 && r <= 110;
}

function isBlackBg(r, g, b) {
  return r < 28 && g < 28 && b < 28;
}

export async function removeLogoBackground(inputPath, outputPath) {
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const transparent = new Uint8Array(w * h);

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const flood = (match) => {
    const queue = [];
    for (let x = 0; x < w; x++) {
      queue.push([x, 0], [x, h - 1]);
    }
    for (let y = 0; y < h; y++) {
      queue.push([0, y], [w - 1, y]);
    }

    while (queue.length) {
      const [x, y] = queue.pop();
      const idx = y * w + x;
      if (transparent[idx]) continue;
      const i = idx * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!match(r, g, b)) continue;
      transparent[idx] = 1;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        queue.push([nx, ny]);
      }
    }
  };

  flood(isGrayBg);

  const floodBlack = () => {
    const queue = [];
    for (let x = 0; x < w; x++) {
      for (const y of [0, h - 1]) {
        const idx = y * w + x;
        if (transparent[idx]) continue;
        const i = idx * 4;
        if (isBlackBg(data[i], data[i + 1], data[i + 2])) queue.push([x, y]);
      }
    }
    for (let y = 0; y < h; y++) {
      for (const x of [0, w - 1]) {
        const idx = y * w + x;
        if (transparent[idx]) continue;
        const i = idx * 4;
        if (isBlackBg(data[i], data[i + 1], data[i + 2])) queue.push([x, y]);
      }
    }

    while (queue.length) {
      const [x, y] = queue.pop();
      const idx = y * w + x;
      if (transparent[idx]) continue;
      const i = idx * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isBlackBg(r, g, b)) continue;

      let touchesForeground = false;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = (ny * w + nx) * 4;
        if (isForeground(data[ni], data[ni + 1], data[ni + 2])) {
          touchesForeground = true;
          break;
        }
      }
      if (touchesForeground) continue;

      transparent[idx] = 1;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        queue.push([nx, ny]);
      }
    }
  };

  floodBlack();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const i = idx * 4;
      if (transparent[idx]) {
        data[i + 3] = 0;
      } else if (isGrayBg(data[i], data[i + 1], data[i + 2])) {
        data[i + 3] = 0;
      }
    }
  }

  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toFile(outputPath);

  console.log("Saved:", outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(__dirname, "../..");
  const targets = [
    path.join(root, "landing/public/logo.png"),
    path.join(root, "dashboard/public/logo.png"),
  ];
  for (const file of targets) {
    await removeLogoBackground(file, file);
  }
}
