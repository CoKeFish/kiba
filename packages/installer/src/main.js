// Tauri APIs are exposed on `window.__TAURI__` when running inside the Tauri shell.
// Use the bundled JS API for `invoke` and the opener plugin for opening URLs.
const { invoke } = window.__TAURI__.core;
const { openUrl } = window.__TAURI__.opener;

const DASHBOARD_URL = "https://dashboard.agent-bazaar.rodion.com.co";
const NODEJS_URL = "https://nodejs.org/en/download";

let detectedClients = [];
let selectedIds = new Set();

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("visible"));
  $("screen-" + name).classList.add("visible");
}

function renderClients() {
  const list = $("client-list");
  list.innerHTML = "";
  for (const c of detectedClients) {
    const li = document.createElement("li");
    li.className = "client";
    if (c.already_installed) li.classList.add("disabled");

    const tagHtml = c.already_installed
      ? '<span class="tag installed">Already installed</span>'
      : c.exists
      ? '<span class="tag detected">Detected</span>'
      : '<span class="tag notfound">Not found</span>';

    li.innerHTML = `
      <input type="checkbox" ${c.already_installed ? "disabled" : ""} />
      <div class="client-meta">
        <div class="client-name">${escapeHtml(c.name)}</div>
        <div class="client-status">${escapeHtml(c.config_path)}</div>
      </div>
      ${tagHtml}
    `;

    if (!c.already_installed) {
      li.addEventListener("click", (e) => {
        if (e.target.tagName === "INPUT") return; // already toggled by browser
        const cb = li.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        toggleSelection(c.id, cb.checked, li);
      });
      li.querySelector("input").addEventListener("change", (e) => {
        toggleSelection(c.id, e.target.checked, li);
      });
    }

    list.appendChild(li);
  }
  updateInstallButton();
}

function toggleSelection(id, checked, li) {
  if (checked) {
    selectedIds.add(id);
    li.classList.add("selected");
  } else {
    selectedIds.delete(id);
    li.classList.remove("selected");
  }
  updateInstallButton();
}

function updateInstallButton() {
  $("btn-install").disabled = selectedIds.size === 0;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function init() {
  showScreen("loading");
  const hasNode = await invoke("check_node");
  if (!hasNode) {
    showScreen("no-node");
    return;
  }
  detectedClients = await invoke("detect_clients");
  renderClients();
  showScreen("pick");
}

async function doInstall() {
  showScreen("installing");
  const ids = Array.from(selectedIds);
  const results = await invoke("install", { clientIds: ids });
  renderResults(results);
  showScreen("done");
}

function renderResults(results) {
  const list = $("result-list");
  list.innerHTML = "";
  for (const r of results) {
    const c = detectedClients.find((c) => c.id === r.client_id);
    const name = c?.name ?? r.client_id;
    const li = document.createElement("li");
    li.className = "result " + (r.ok ? "ok" : "fail");
    li.innerHTML = `
      <span class="result-icon">${r.ok ? "✓" : "✗"}</span>
      <span><strong>${escapeHtml(name)}</strong> — ${escapeHtml(r.message)}</span>
    `;
    list.appendChild(li);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("btn-install").addEventListener("click", doInstall);
  $("btn-dashboard").addEventListener("click", () => openUrl(DASHBOARD_URL));
  $("btn-close").addEventListener("click", () => window.close());
  $("open-nodejs").addEventListener("click", (e) => {
    e.preventDefault();
    openUrl(NODEJS_URL);
  });
  init();
});
