import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAD = 100;

function isColored(r, g, b) {
  return r > 70 || g > 70 || b > 70;
}

function isDark(r, g, b) {
  return r < 55 && g < 55 && b < 55;
}

function growFromColor(data, w, h, steps) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isColored(data[i], data[i + 1], data[i + 2])) mask[y * w + x] = 1;
    }
  }
  for (let n = 0; n < steps; n++) {
    const next = new Uint8Array(mask);
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
          const i = idx * 4;
          if (isDark(data[i], data[i + 1], data[i + 2])) next[idx] = 1;
        }
      }
    }
    mask.set(next);
  }
  return mask;
}

export async function processMascotGrow(inputPath, outputPath, growSteps = 175) {
  const input = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sw = input.info.width;
  const sh = input.info.height;
  const w = sw + PAD * 2;
  const h = sh + PAD * 2;
  const px = Buffer.alloc(w * h * 4, 0);

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (y * sw + x) * 4;
      const di = ((y + PAD) * w + (x + PAD)) * 4;
      px[di] = input.data[si];
      px[di + 1] = input.data[si + 1];
      px[di + 2] = input.data[si + 2];
      px[di + 3] = 255;
    }
  }

  const mask = growFromColor(px, w, h, growSteps);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i + 3] = mask[y * w + x] ? 255 : 0;
    }
  }

  await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toFile(outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assets =
    "C:/Users/Angie Mariela/.cursor/projects/c-Users-Angie-Mariela-OneDrive-Documentos-Kiba-Web-kiba/assets";
  const dir = path.join(__dirname, "../public/agents");
  const blobSrc = path.join(
    assets,
    "c__Users_Angie_Mariela_AppData_Roaming_Cursor_User_workspaceStorage_28237b48be5c9f27308cc2ed64541c05_images_Untitled_Artwork_1-e838bdb3-8ed7-41dd-baf1-47ab7acfdc98.png",
  );
  const squareSrc = path.join(
    assets,
    "c__Users_Angie Mariela_AppData_Roaming_Cursor_User_workspaceStorage_28237b48be5c9f27308cc2ed64541c05_images_Untitled_Artwork_1__1-3937e0b9-de09-415a-ad30-939e6832c6c2.png",
  );

  await processMascotGrow(squareSrc, path.join(dir, "square.png"), 130);
  await processMascotGrow(blobSrc, path.join(dir, "blob.png"), 185);
  console.log("OK");
}
