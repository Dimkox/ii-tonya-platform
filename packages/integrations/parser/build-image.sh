#!/bin/sh
set -eu
# Build-time assets only. Runtime never downloads a model or invokes Docker.
assets=${1:?supply the directory containing the two pinned models}
parser_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
context_dir=$(mktemp -d)
trap 'rm -rf "$context_dir"' EXIT
cp "$parser_dir/Dockerfile" "$parser_dir/requirements.txt" "$parser_dir/helper.py" "$parser_dir/socket_server.py" "$context_dir/"
cp "$assets/rus.traineddata" "$assets/eng.traineddata" "$context_dir/"
docker build --tag ii-tonya-private-parser:1 "$context_dir"
