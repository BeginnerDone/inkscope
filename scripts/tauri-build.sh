#!/bin/sh
set -eu

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export CARGO_HOME="${INKSCOPE_CARGO_HOME:-${TMPDIR:-/private/tmp}/inkscope-cargo}"
npm run build
cargo build --release --manifest-path src-tauri/Cargo.toml
