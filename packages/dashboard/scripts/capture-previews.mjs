import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const outDir = path.resolve(__dirname, "../public/previews");
mkdirSync(outDir, { recursive: true });

function startServe(dir, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "serve", dir, "-l", String(port), "--no-clipboard"],
      { stdio: "ignore", shell: true },
    );
    setTimeout(() => resolve(proc), 2500);
    proc.on("error", reject);
  });
}

async function shot(page, url, file, width, height, fullPage = false) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: file, fullPage });
  console.log("Saved:", file);
}

const gw = await startServe(path.join(root, "gateway/public"), 8765);
const land = await startServe(path.join(root, "landing/dist"), 8766);

const browser = await chromium.launch();
const page = await browser.newPage();

await shot(
  page,
  "http://127.0.0.1:8765/preview-consent.html",
  path.join(outDir, "oauth-consent.png"),
  1280,
  800,
);

await shot(
  page,
  "http://127.0.0.1:8766/",
  path.join(outDir, "landing-full.png"),
  1440,
  900,
  true,
);

await shot(
  page,
  "http://127.0.0.1:8766/",
  path.join(outDir, "landing-top.png"),
  1440,
  720,
);

await browser.close();
gw.kill();
land.kill();
