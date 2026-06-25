// Kiba MCP Installer
//
// One-shot job: detect Claude Desktop / Cursor / Claude Code configs on the
// host machine, then surgically inject the kiba MCP server entry
// into each. Backs up existing files before touching them.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

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

// ─── Helpers reutilizables (install + uninstall) ──────────────

/// Lee y parsea la config. `Ok(None)` si no existe o está vacía;
/// `Err` con mensaje accionable si el JSON es inválido (no se toca el archivo).
fn read_config(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|e| format!("Could not read config: {}", e))?;
    if content.trim().is_empty() {
        return Ok(None);
    }
    serde_json::from_str(&content).map(Some).map_err(|e| {
        format!("Existing config is not valid JSON: {}. Fix or delete it before retrying.", e)
    })
}

/// Copia el archivo a `<name>.json.bak` antes de modificar. `Ok(None)` si aún no existe.
fn backup(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bak = path.with_extension("json.bak");
    fs::copy(path, &bak).map_err(|e| format!("Could not write backup: {}", e))?;
    Ok(Some(bak.to_string_lossy().to_string()))
}

/// Escritura ATÓMICA: vuelca a un `.json.tmp` y luego renombra sobre el destino.
/// Evita dejar la config a medio escribir si el proceso muere a mitad.
fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)
}

/// Inserta/actualiza `mcpServers.kiba`. Crea `mcpServers` si falta.
/// `Err` si el root o `mcpServers` existen pero no son objetos (no se corrompe nada).
fn inject_kiba(config: &mut Value) -> Result<(), String> {
    let obj = config
        .as_object_mut()
        .ok_or_else(|| "config root is not a JSON object".to_string())?;
    let mcp_servers = obj
        .entry("mcpServers".to_string())
        .or_insert_with(|| json!({}));
    match mcp_servers.as_object_mut() {
        Some(map) => {
            map.insert("kiba".to_string(), mcp_block());
            Ok(())
        }
        None => Err("Existing `mcpServers` field is not an object".to_string()),
    }
}

/// Quita `mcpServers.kiba`. Devuelve `true` si estaba presente. Si `mcpServers`
/// queda vacío, elimina también esa clave (config limpia).
fn remove_kiba(config: &mut Value) -> bool {
    let Some(obj) = config.as_object_mut() else {
        return false;
    };
    let Some(mcp) = obj.get_mut("mcpServers").and_then(|m| m.as_object_mut()) else {
        return false;
    };
    let removed = mcp.remove("kiba").is_some();
    if mcp.is_empty() {
        obj.remove("mcpServers");
    }
    removed
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
    let mut config = match read_config(&path) {
        Ok(Some(v)) => v,
        Ok(None) => json!({}),
        Err(e) => {
            return InstallResult { client_id: client.id.clone(), ok: false, message: e, backup_path: None }
        }
    };

    // Backup before touching
    let backup_path = match backup(&path) {
        Ok(b) => b,
        Err(e) => {
            return InstallResult { client_id: client.id.clone(), ok: false, message: e, backup_path: None }
        }
    };

    // Inject mcpServers.kiba
    if let Err(e) = inject_kiba(&mut config) {
        return InstallResult { client_id: client.id.clone(), ok: false, message: e, backup_path };
    }

    // Serialize + atomic write
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
    if let Err(e) = write_atomic(&path, &pretty) {
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

// ─── Uninstall ───────────────────────────────────────────────

/// Quita quirúrgicamente el bloque `kiba` de la config del cliente, preservando
/// el resto de `mcpServers` y cualquier otro ajuste del usuario. NO restaura el
/// `.bak` (que pudo quedar contaminado al reinstalar) — solo borra la clave kiba.
fn uninstall_one(client: &McpClient) -> InstallResult {
    let path = PathBuf::from(&client.config_path);

    let mut config = match read_config(&path) {
        Ok(Some(v)) => v,
        Ok(None) => {
            return InstallResult {
                client_id: client.id.clone(),
                ok: true,
                message: "Not installed (no config file)".to_string(),
                backup_path: None,
            }
        }
        Err(e) => {
            return InstallResult { client_id: client.id.clone(), ok: false, message: e, backup_path: None }
        }
    };

    // Si kiba no está, no tocamos el archivo (idempotente).
    let present = config
        .get("mcpServers")
        .and_then(|m| m.get("kiba"))
        .is_some();
    if !present {
        return InstallResult {
            client_id: client.id.clone(),
            ok: true,
            message: "kiba was not configured".to_string(),
            backup_path: None,
        };
    }

    // Backup antes de modificar
    let backup_path = match backup(&path) {
        Ok(b) => b,
        Err(e) => {
            return InstallResult { client_id: client.id.clone(), ok: false, message: e, backup_path: None }
        }
    };

    remove_kiba(&mut config);

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
    if let Err(e) = write_atomic(&path, &pretty) {
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
        message: "Removed".to_string(),
        backup_path,
    }
}

#[tauri::command]
fn uninstall(client_ids: Vec<String>) -> Vec<InstallResult> {
    let detected = detect_clients();
    let mut results = vec![];
    for id in client_ids {
        match detected.iter().find(|c| c.id == id) {
            Some(c) => results.push(uninstall_one(c)),
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
            uninstall,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_adds_kiba_and_preserves_others() {
        let mut c = json!({ "mcpServers": { "other": { "command": "x" } } });
        inject_kiba(&mut c).unwrap();
        assert!(c["mcpServers"]["kiba"].is_object());
        assert!(c["mcpServers"]["other"].is_object()); // preservado
    }

    #[test]
    fn inject_is_idempotent() {
        let mut c = json!({});
        inject_kiba(&mut c).unwrap();
        inject_kiba(&mut c).unwrap();
        assert!(c["mcpServers"]["kiba"].is_object()); // un solo objeto kiba, sin duplicar
    }

    #[test]
    fn inject_errors_on_non_object_mcpservers() {
        let mut c = json!({ "mcpServers": [] });
        assert!(inject_kiba(&mut c).is_err());
    }

    #[test]
    fn remove_takes_out_kiba_keeps_others() {
        let mut c = json!({ "mcpServers": { "kiba": { "command": "npx" }, "other": { "command": "x" } } });
        assert!(remove_kiba(&mut c));
        assert!(c["mcpServers"].get("kiba").is_none());
        assert!(c["mcpServers"]["other"].is_object());
    }

    #[test]
    fn remove_drops_empty_mcpservers_and_returns_false_when_absent() {
        let mut c = json!({ "mcpServers": { "kiba": {} } });
        assert!(remove_kiba(&mut c));
        assert!(c.get("mcpServers").is_none()); // quedó vacío → eliminado
        assert!(!remove_kiba(&mut c)); // ya no está
    }

    #[test]
    fn install_then_uninstall_roundtrip_on_temp_file() {
        let dir = std::env::temp_dir().join(format!("kiba-installer-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cfg.json");
        // config previa con OTRO mcp server que debe sobrevivir
        fs::write(&path, r#"{"mcpServers":{"other":{"command":"x"}},"theme":"dark"}"#).unwrap();
        let client = McpClient {
            id: "t".into(),
            name: "T".into(),
            config_path: path.to_string_lossy().to_string(),
            exists: true,
            already_installed: false,
        };

        // install
        let r = install_one(&client);
        assert!(r.ok, "install: {}", r.message);
        let after: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert!(after["mcpServers"]["kiba"].is_object());
        assert!(after["mcpServers"]["other"].is_object()); // preservado
        assert_eq!(after["theme"], "dark"); // resto de la config intacto

        // re-install no duplica
        assert!(install_one(&client).ok);

        // uninstall
        let u = uninstall_one(&client);
        assert!(u.ok, "uninstall: {}", u.message);
        let after2: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert!(after2.get("mcpServers").and_then(|m| m.get("kiba")).is_none(), "kiba debe irse");
        assert!(after2["mcpServers"]["other"].is_object(), "otros servers se preservan");
        assert_eq!(after2["theme"], "dark");

        // uninstall idempotente
        assert!(uninstall_one(&client).ok);

        let _ = fs::remove_dir_all(&dir);
    }
}
