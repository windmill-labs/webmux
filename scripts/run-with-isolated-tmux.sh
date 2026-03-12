#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "Usage: bash scripts/run-with-isolated-tmux.sh <command> [args...]" >&2
  exit 1
fi

tmux_bin="$(command -v tmux || true)"
if [ -z "$tmux_bin" ]; then
  echo "tmux not found in PATH" >&2
  exit 127
fi

config_path="${WEBMUX_ISOLATED_TMUX_CONFIG:-/dev/null}"
if [ ! -e "$config_path" ]; then
  echo "tmux config not found: $config_path" >&2
  exit 1
fi

socket_name="${WEBMUX_ISOLATED_TMUX_SOCKET_NAME:-webmux-isolated-$$-$(date +%s)}"
tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/webmux-isolated-tmux.XXXXXX")"
bin_dir="$tmp_root/bin"
wrapper_path="$bin_dir/tmux"
mkdir -p "$bin_dir"

cat > "$wrapper_path" <<EOF
#!/usr/bin/env bash
exec "$tmux_bin" -L "$socket_name" -f "$config_path" "\$@"
EOF

chmod +x "$wrapper_path"

cleanup() {
  env -u TMUX PATH="$bin_dir:$PATH" "$wrapper_path" kill-server >/dev/null 2>&1 || true
  rm -rf "$tmp_root"
}

trap cleanup EXIT INT TERM

export PATH="$bin_dir:$PATH"
export WEBMUX_ISOLATED_TMUX_CONFIG="$config_path"
export WEBMUX_ISOLATED_TMUX_SOCKET="$socket_name"
unset TMUX

"$@"
