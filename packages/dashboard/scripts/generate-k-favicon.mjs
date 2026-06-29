import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

function isForeground(r, g, b, a) {
  if (a < 10) return false;
  if (r > 140 && g < 120 && b < 120 && r > g + 20) return true;
  if (r > 180 && g > 130 && b > 180) return true;
  if (g > 130 && r < 150 && b < 150 && g > r + 20) return true;
  if (r < 28 && g < 28 && b < 28) return true;
  return false;
}

async function findKBounds(logoPath) {
  const { data, info } = await sharp(logoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;

  const colCounts = new Array(w).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isForeground(data[i], data[i + 1], data[i + 2], data[i + 3])) colCounts[x]++;
    }
  }

  let start = 0;
  while (start < w && colCounts[start] === 0) start++;

  let end = start;
  let gap = 0;
  for (let x = start + 1; x < w; x++) {
    if (colCounts[x] === 0) {
      gap++;
      if (gap > 8) {
        end = x - gap;
        break;
      }
    } else {
      gap = 0;
      end = x;
    }
  }

  let minY = h;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = start; x <= end; x++) {
      const i = (y * w + x) * 4;
      if (isForeground(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return { left: start, top: minY, width: end - start + 1, height: maxY - minY + 1 };
}

export async function generateKFavicon(logoPath, outputPath, size = 32) {
  const bounds = await findKBounds(logoPath);
  const pad = Math.round(Math.max(bounds.width, bounds.height) * 0.08);
  const side = Math.max(bounds.width, bounds.height) + pad * 2;
  const padLeft = Math.floor((side - bounds.width) / 2);
  const padRight = side - bounds.width - padLeft;
  const padTop = Math.floor((side - bounds.height) / 2);
  const padBottom = side - bounds.height - padTop;

  await sharp(logoPath)
    .extract({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    })
    .extend({
      top: padTop,
      bottom: padBottom,
      left: padLeft,
      right: padRight,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);

  console.log("Saved:", outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const logo = path.join(root, "landing/public/logo.png");
  const targets = [
    path.join(root, "landing/public/favicon.png"),
    path.join(root, "dashboard/public/favicon.png"),
  ];

  for (const out of targets) {
    await generateKFavicon(logo, out, 32);
  }
}
