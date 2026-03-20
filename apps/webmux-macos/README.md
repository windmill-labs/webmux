# webmux-macos

macOS-only SwiftUI proof of concept for `webmux` with an embedded Ghostty terminal.

This target is intentionally small:

- one window
- worktree sidebar
- create/open/close worktree actions
- native terminal surface attached to the selected worktree
- saved local or remote webmux server connections

For a detailed gap analysis against the current web UI, see [FEATURE_PARITY.md](FEATURE_PARITY.md).

It is a development POC, not a signed or notarized desktop app.

## Architecture

The current runtime flow is:

1. `WebmuxMacOSApp` boots a single SwiftUI window.
2. `ConnectionsStore` persists user-added server connections in `UserDefaults`.
3. `WorktreeStore` connects to the selected project through `WebmuxConnection`.
4. `BackendClient` loads `GET /api/project` and populates the sidebar.
5. Selecting an open worktree fetches `GET /api/worktrees/:name/terminal-launch`.
6. `TerminalCommandFactory` runs the backend-provided launch command locally or wraps it in SSH.
7. `GhosttyTerminalView` embeds a native Ghostty surface and runs that command.

Main files:

- `Sources/WebmuxMacOS/WebmuxMacOSApp.swift`
  - app entry point
- `Sources/WebmuxMacOS/ContentView.swift`
  - sidebar, detail pane, toolbar, project management, create sheet, terminal panel
- `Sources/WebmuxMacOS/ConnectionsStore.swift`
  - saved project persistence, validation, add/edit/remove flows
- `Sources/WebmuxMacOS/WorktreeStore.swift`
  - active project state, worktree actions, terminal attach resolution
- `Sources/WebmuxMacOS/WebmuxConnection.swift`
  - runtime connection abstraction for local and remote servers
- `Sources/WebmuxMacOS/BackendClient.swift`
  - minimal HTTP client for the webmux API
- `Sources/WebmuxMacOS/BackendModels.swift`
  - request and response models
- `Sources/WebmuxMacOS/AppEnvironment.swift`
  - Ghostty resource discovery
- `Sources/WebmuxMacOS/TerminalCommandFactory.swift`
  - local vs SSH command transport wrapper
- `Sources/WebmuxMacOS/GhosttyRuntime.swift`
  - `GhosttyKit` runtime bootstrap and clipboard/action callbacks
- `Sources/WebmuxMacOS/GhosttyTerminalView.swift`
  - AppKit wrapper around the embedded Ghostty surface
- `scripts/build-ghosttykit.sh`
  - builds `GhosttyKit.xcframework` and copies Ghostty resources

## Runtime model

The app depends on:

- this repo checkout while developing from source
- Ghostty assets under `apps/webmux-macos/ThirdParty/`
- one or more user-managed webmux servers

Connection types:

- local
  - API URL must be loopback such as `http://127.0.0.1:5111`
  - terminal commands run locally on the Mac
- remote
  - API URL can be a reachable remote server such as a Tailscale IP
  - terminal commands run over SSH

The app does not start `webmux serve` for you in this v1.

## Prerequisites

You need:

- macOS 15 or newer
- Xcode with Swift 6.1 support
- `zig`

If you want to connect to a local server from the app, you also need whatever your local `webmux serve` setup requires, typically:

- `bun`
- `tmux`
- `git`

If Ghostty build complains about missing Apple toolchain pieces, install the Xcode Metal toolchain component first.

## Bootstrap dependencies

The Swift package expects a locally built Ghostty binary target and resource payload:

```bash
./scripts/build-ghosttykit.sh
```

That script:

- clones Ghostty
- builds `GhosttyKit.xcframework`
- copies Ghostty runtime resources into `apps/webmux-macos/ThirdParty/GhosttyResources`

Those assets are intentionally ignored by git.

## Run in development

Build:

```bash
swift build --package-path apps/webmux-macos
```

Run:

```bash
swift run --package-path apps/webmux-macos
```

On first launch:

1. Click `Add Project`.
2. Enter a local or remote webmux server URL.
3. Choose whether terminal commands should run locally or over SSH.
4. Let the app test `GET /api/project` before saving the connection.

Examples:

- local loopback server
  - URL: `http://127.0.0.1:5111`
  - connection type: `Local`
- remote server
  - URL: `http://100.x.y.z:5111`
  - connection type: `Remote`
  - SSH host/user as needed

## Useful environment variables

These are optional while developing:

- `WEBMUX_NATIVE_REPO_ROOT`
  - override repo root discovery for Ghostty asset lookup
- `WEBMUX_NATIVE_GHOSTTY_RESOURCES_DIR`
  - override the Ghostty resource directory
- `GHOSTTY_RESOURCES_DIR`
  - fallback resource override if the app-local one is not set

Example:

```bash
WEBMUX_NATIVE_GHOSTTY_RESOURCES_DIR="$PWD/apps/webmux-macos/ThirdParty/GhosttyResources/share/ghostty" \
swift run --package-path apps/webmux-macos
```

## Development test checklist

Start the app and validate the current POC end to end:

1. Add a local loopback server and confirm the sidebar loads worktrees from `GET /api/project`.
2. Add a remote server and confirm it appears in the project selector.
3. Switch between saved projects and verify the detail pane reloads.
4. Open the create worktree sheet and verify branch text entry works.
5. Select an open worktree and confirm the terminal panel attaches.
6. In the terminal, verify:
   - `pwd`
   - `echo $TERM`
   - `nvim`
   - `lazygit`
   - long-running CLI output
   - resize behavior
   - copy/paste
7. Close the worktree and confirm the terminal panel returns to the placeholder state.

Useful external checks while a local server is running:

```bash
curl -sS http://127.0.0.1:5111/api/project | jq .
curl -sS http://127.0.0.1:5111/api/worktrees/<branch>/terminal-launch | jq .
```

## Bundle it

There is no automated packaging target yet. The current bundle story is a manual development bundle around the SwiftPM executable.

### Build a release executable

```bash
swift build --package-path apps/webmux-macos --configuration release
```

### Create a dev `.app`

```bash
APP_DIR="$PWD/dist/WebmuxMacOS.app"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp apps/webmux-macos/.build/arm64-apple-macosx/release/WebmuxMacOS \
  "$APP_DIR/Contents/MacOS/WebmuxMacOS"
cp -R apps/webmux-macos/ThirdParty/GhosttyResources \
  "$APP_DIR/Contents/Resources/GhosttyResources"

cat > "$APP_DIR/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>WebmuxMacOS</string>
  <key>CFBundleIdentifier</key>
  <string>dev.webmux.macos</string>
  <key>CFBundleName</key>
  <string>WebmuxMacOS</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>15.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF
```

### Launch the bundle in development

The safest option is to point the app explicitly at the bundled Ghostty resources:

```bash
APP_DIR="$PWD/dist/WebmuxMacOS.app"

WEBMUX_NATIVE_GHOSTTY_RESOURCES_DIR="$APP_DIR/Contents/Resources/GhosttyResources/share/ghostty" \
"$APP_DIR/Contents/MacOS/WebmuxMacOS"
```

What this does not do:

- code signing
- notarization
- updater support
- standalone distribution polish
