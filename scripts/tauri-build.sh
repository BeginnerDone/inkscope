#!/bin/sh
set -eu

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
if [ -n "${INKSCOPE_CARGO_HOME:-}" ]; then
  export CARGO_HOME="$INKSCOPE_CARGO_HOME"
fi

cargo tauri build "$@"
