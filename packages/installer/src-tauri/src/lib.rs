// Kiba MCP Installer
//
// One-shot job: detect Claude Desktop / Cursor / Claude Code configs on the
// host machine, then surgically inject the kiba MCP server entry
// into each. Backs up existing files before touching them.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

// ─── Client detection ─────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct McpClient {
    pub id: String,           // "claude-desktop" | "cursor" | "claude-code"
    pub name: String,         // human label
    pub config_path: String,  // absolute path
    pub exists: bool,         // does the directory we'd write to exist?
    pub already_installed: bool, // is kiba already configured?
}

fn home() -> Option<PathBuf> {
    dirs::home_dir()
}

fn appdata_roaming() -> Option<PathBuf> {
    // Windows: %APPDATA% (Roaming). On other OS, dirs::config_dir() approximates.
    #[cfg(target_os = "windows")]
    {
        dirs::config_dir()
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs::config_dir()
    }
}

fn claude_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        appdata_roaming().map(|p| p.join("Claude").join("claude_desktop_config.json"))
    }
    #[cfg(target_os = "macos")]
    {
        home().map(|p| {
            p.join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    }
    #[cfg(target_os = "linux")]
    {
        home().map(|p| p.join(".config").join("Claude").join("claude_desktop_config.json"))
    }
}

fn cursor_config_path() -> Option<PathBuf> {
    home().map(|p| p.join(".cursor").join("mcp.json"))
}

fn claude_code_config_path() -> Option<PathBuf> {
    home().map(|p| p.join(".claude.json"))
}

fn detect_client(id: &str, name: &str, path: PathBuf) -> McpClient {
    let parent_exists = path.parent().map(|p| p.exists()).unwrap_or(false);
    let already_installed = if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(v) => v
                    .get("mcpServers")
                    .and_then(|m| m.get("kiba"))
                    .is_some(),
                Err(_) => false,
            },
            Err(_) => false,
        }
    } else {
        false
    };
    McpClient {
        id: id.to_string(),
        name: name.to_string(),
        config_path: path.to_string_lossy().to_string(),
        exists: parent_exists,
        already_installed,
    }
}

#[tauri::command]
fn detect_clients() -> Vec<McpClient> {
    let mut out = vec![];
    if let Some(p) = claude_desktop_config_path() {
        out.push(detect_client("claude-desktop", "Claude Desktop", p));
    }
    if let Some(p) = cursor_config_path() {
        out.push(detect_client("cursor", "Cursor", p));
    }
    if let Some(p) = claude_code_config_path() {
        out.push(detect_client("claude-code", "Claude Code (CLI)", p));
    }
    out
}

#[tauri::command]
fn check_node() -> bool {
    which::which("node").is_ok()
}

// ─── Install ─────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct InstallResult {
    pub client_id: String,
    pub ok: bool,
    pub message: String,
    pub backup_path: Option<String>,
}

/// URL del gateway de producción inyectada en la config del cliente. Aunque el
/// MCP server tiene este mismo default hardcoded (`packages/mcp-server/src/index.ts`),
/// lo declaramos explícito acá para que el config sea autodescriptivo y para
/// que el usuario pueda apuntar a un gateway propio editando solo este campo.
const PROD_GATEWAY_URL: &str = "https://kiba-api.rodion.com.co";

fn mcp_block() -> Value {
    // En Windows, `npx` no es un ejecutable directo (es `npx.cmd`). Los clientes
    // MCP que usan `child_process.spawn` sin shell (Claude Code, Cursor) fallan
    // con ENOENT al buscar `npx` literal. Workaround validado por chrome-devtools
    // MCP: spawn `cmd /c npx ...` que Windows sí resuelve. En macOS/Linux `npx`
    // sirve directo.
    #[cfg(target_os = "windows")]
    {
        json!({
            "command": "cmd",
            "args": ["/c", "npx", "-y", "kiba-mcp"],
            "env": {
                "KIBA_URL": PROD_GATEWAY_URL
            }
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        json!({
            "command": "npx",
            "args": ["-y", "kiba-mcp"],
            "env": {
                "KIBA_URL": PROD_GATEWAY_URL
            }
        })
    }
}

fn install_one(client: &McpClient) -> InstallResult {
    let path = PathBuf::from(&client.config_path);

    // Ensure parent dir exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return InstallResult {
                    client_id: client.id.clone(),
                    ok: false,
                    message: format!("Could not create directory: {}", e),
                    backup_path: None,
                };
            }
        }
    }

    // Read existing config (or start fresh)
    let mut config: Value = if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) if !content.trim().is_empty() => match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(e) => {
                    return InstallResult {
                        client_id: client.id.clone(),
                        ok: false,
                        message: format!("Existing config is not valid JSON: {}. Fix or delete it before retrying.", e),
                        backup_path: None,
                    }
                }
            },
            _ => json!({}),
        }
    } else {
        json!({})
    };

    // Backup if file exists
    let backup_path = if path.exists() {
        let bak = path.with_extension("json.bak");
        if let Err(e) = fs::copy(&path, &bak) {
            return InstallResult {
                client_id: client.id.clone(),
                ok: false,
                message: format!("Could not write backup: {}", e),
                backup_path: None,
            };
        }
        Some(bak.to_string_lossy().to_string())
    } else {
        None
    };

    // Inject mcpServers.kiba
    let obj = config.as_object_mut().unwrap_or_else(|| unreachable!());
    let mcp_servers = obj
        .entry("mcpServers".to_string())
        .or_insert_with(|| json!({}));
    if let Some(map) = mcp_servers.as_object_mut() {
        map.insert("kiba".to_string(), mcp_block());
    } else {
        return InstallResult {
            client_id: client.id.clone(),
            ok: false,
            message: "Existing `mcpServers` field is not an object".to_string(),
            backup_path,
        };
    }

    // Write back, pretty-printed
    let pretty = match serde_json::to_string_pretty(&config) {
        Ok(s) => s,
        Err(e) => {
            return InstallResult {
                client_id: client.id.clone(),
                ok: false,
                message: format!("Could not serialize config: {}", e),
                backup_path,
            }
        }
    };
    if let Err(e) = fs::write(&path, pretty) {
        return InstallResult {
            client_id: client.id.clone(),
            ok: false,
            message: format!("Could not write config: {}", e),
            backup_path,
        };
    }

    InstallResult {
        client_id: client.id.clone(),
        ok: true,
        message: "Installed".to_string(),
        backup_path,
    }
}

#[tauri::command]
fn install(client_ids: Vec<String>) -> Vec<InstallResult> {
    let detected = detect_clients();
    let mut results = vec![];
    for id in client_ids {
        match detected.iter().find(|c| c.id == id) {
            Some(c) => results.push(install_one(c)),
            None => results.push(InstallResult {
                client_id: id,
                ok: false,
                message: "Client not found in detection".to_string(),
                backup_path: None,
            }),
        }
    }
    results
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Delegated to plugin-opener at the frontend layer; this stub kept for
    // explicit invocation if needed.
    let _ = url;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            detect_clients,
            check_node,
            install,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
