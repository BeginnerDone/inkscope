#!/bin/sh
set -eu

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

npm run dev &
VITE_PID=$!
cleanup() {
  kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1
cargo run --manifest-path src-tauri/Cargo.toml
