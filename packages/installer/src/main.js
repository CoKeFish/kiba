// Tauri APIs are exposed on `window.__TAURI__` when running inside the Tauri shell.
// Use the bundled JS API for `invoke` and the opener plugin for opening URLs.
const { invoke } = window.__TAURI__.core;
const { openUrl } = window.__TAURI__.opener;

const DASHBOARD_URL = "https://kiba-dashboard.vercel.app";
const NODEJS_URL = "https://nodejs.org/en/download";

let detectedClients = [];
let selectedIds = new Set();
let mode = "install"; // "install" | "uninstall"

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("visible"));
  $("screen-" + name).classList.add("visible");
}

function renderClients() {
  const list = $("client-list");
  list.innerHTML = "";
  for (const c of detectedClients) {
    // En install: seleccionable si NO está ya instalado. En uninstall: solo si lo está.
    const selectable = mode === "install" ? !c.already_installed : c.already_installed;
    const li = document.createElement("li");
    li.className = "client";
    if (!selectable) li.classList.add("disabled");

    let tagHtml;
    if (mode === "install") {
      tagHtml = c.already_installed
        ? '<span class="tag installed">Already installed</span>'
        : c.exists
        ? '<span class="tag detected">Detected</span>'
        : '<span class="tag notfound">Not found</span>';
    } else {
      tagHtml = c.already_installed
        ? '<span class="tag installed">Installed</span>'
        : '<span class="tag notfound">Not installed</span>';
    }

    li.innerHTML = `
      <input type="checkbox" ${selectable ? "" : "disabled"} />
      <div class="client-meta">
        <div class="client-name">${escapeHtml(c.name)}</div>
        <div class="client-status">${escapeHtml(c.config_path)}</div>
      </div>
      ${tagHtml}
    `;

    if (selectable) {
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
  const btn = $("btn-install");
  const n = selectedIds.size;
  btn.disabled = n === 0;
  const verb = mode === "install" ? "Install" : "Remove";
  btn.textContent = n > 0 ? `${verb} (${n})` : verb;
}

function setMode(m) {
  if (mode === m) return;
  mode = m;
  selectedIds.clear();
  $("mode-install").classList.toggle("active", m === "install");
  $("mode-uninstall").classList.toggle("active", m === "uninstall");
  $("pick-title").textContent =
    m === "install" ? "Where do you want to install?" : "Where do you want to remove Kiba?";
  $("pick-sub").textContent =
    m === "install"
      ? "We'll add Kiba to the MCP config of each selected client. Existing settings are backed up automatically."
      : "We'll remove the Kiba entry from each selected client. Your other MCP servers are kept.";
  renderClients();
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

async function runAction() {
  const isInstall = mode === "install";
  $("installing-label").textContent = isInstall ? "Installing…" : "Removing…";
  showScreen("installing");
  const ids = Array.from(selectedIds);
  const results = await invoke(isInstall ? "install" : "uninstall", { clientIds: ids });
  renderResults(results);
  $("done-title").textContent = isInstall ? "Done" : "Removed";
  $("done-note").innerHTML = isInstall
    ? `Restart your client and you'll see four new tools: <code>list_agents</code>, <code>call_agent</code>, <code>get_balance</code>, <code>get_transactions</code>.`
    : `Kiba was removed from the selected clients. Restart them to drop the tools.`;
  // "Open dashboard" no aplica al desinstalar.
  $("btn-dashboard").style.display = isInstall ? "" : "none";
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
  $("btn-install").addEventListener("click", runAction);
  $("mode-install").addEventListener("click", () => setMode("install"));
  $("mode-uninstall").addEventListener("click", () => setMode("uninstall"));
  $("btn-dashboard").addEventListener("click", () => openUrl(DASHBOARD_URL));
  $("btn-close").addEventListener("click", () => window.close());
  $("open-nodejs").addEventListener("click", (e) => {
    e.preventDefault();
    openUrl(NODEJS_URL);
  });
  init();
});
