# Agent Bazaar Installer

A double-clickable `.exe` that installs the Agent Bazaar MCP server into Claude
Desktop, Cursor, and/or Claude Code — without the user ever opening a terminal.

Solves the friction that today blocks non-technical users from giving their
LLM real capabilities: copying API keys, editing JSON configs, finding the
right path on their OS.

## What it does

1. Detects which MCP clients you have installed (Claude Desktop, Cursor,
   Claude Code) by looking for their config files in the standard locations.
2. Lets you pick which to install in (clients already having Agent Bazaar
   are shown as "Already installed" and disabled).
3. Backs up your existing config (`*.json.bak`) before touching anything.
4. Surgically inserts the `mcpServers.agent-bazaar` block, preserving every
   other setting you had.
5. Closes with a "Open Dashboard" button so the user lands at signup.

If Node.js isn't installed, the installer detects that up front and offers
to open `nodejs.org` — `npx -y agent-bazaar-mcp` won't run without it.

## Stack

- **Tauri 2** (Rust + WebView2 on Windows). Final binary ~3-5 MB.
- **Frontend**: vanilla HTML/CSS/JS, dark Solana palette, ~3 KB total.
- **Backend**: Rust commands (`detect_clients`, `check_node`, `install`)
  invoked from JS via `@tauri-apps/api`.
- **No frameworks**, no build step for the frontend, no Node bundler.

## Build prerequisites

1. **Rust** (any recent stable). Install via `winget install Rustlang.Rustup`
   on Windows.
2. **MSVC Build Tools** (Windows only): `winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools"`
3. **Node.js** ≥ 18 (for the Tauri CLI npm wrapper).

After installing, verify:

```
rustc --version
cargo --version
node --version
```

## Build steps

From `packages/installer/`:

```
# 1. Install JS deps (Tauri CLI)
npm install

# 2. Generate icons (writes PNGs + .ico/.icns into src-tauri/icons/)
npx tauri icon app-icon.png

# 3. Dev mode (live-reload while iterating)
npm run dev

# 4. Production bundle (produces .exe + .msi installer in src-tauri/target/release/bundle/)
npm run build
```

The Windows bundle lives at:

```
src-tauri/target/release/bundle/nsis/Agent Bazaar Installer_0.1.0_x64-setup.exe
src-tauri/target/release/bundle/msi/Agent Bazaar Installer_0.1.0_x64_en-US.msi
```

Either is double-clickable.

## Regenerating the source icon

The source icon (`app-icon.png`, 1024×1024) is generated programmatically by
`gen-source-icon.mjs` — a Solana-green circle on black. To replace it with a
real logo, drop your own 1024×1024 PNG over `app-icon.png` and re-run
`npx tauri icon app-icon.png`.

## How the JSON injection works

For each client config it touches, the installer:

1. Reads the existing JSON (or creates `{}` if missing).
2. Copies the file to `<path>.bak`.
3. Sets `mcpServers["agent-bazaar"]` to:
   ```json
   {
     "command": "npx",
     "args": ["-y", "agent-bazaar-mcp"]
   }
   ```
4. Writes back, pretty-printed (2-space indent).

It does NOT touch any other key in the file. If `mcpServers` already exists,
only the `agent-bazaar` entry inside it is overwritten.

## Config paths inspected

| Client | Windows | macOS | Linux |
|---|---|---|---|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` | `~/.config/Claude/claude_desktop_config.json` |
| Cursor | `%USERPROFILE%\.cursor\mcp.json` | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` |
| Claude Code (CLI) | `%USERPROFILE%\.claude.json` | `~/.claude.json` | `~/.claude.json` |
