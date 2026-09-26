#!/usr/bin/env bash
set -euo pipefail

# Runs scripts/build.sh inside the official emsdk image, so nothing has to be
# installed on the machine: the image already carries emcc, cmake, node, python
# and git.
#
# Usage:  ./build-docker.sh [upstream|multi]
#
# EMSDK_TAG is deliberately "latest" rather than a pinned version. The emsdk
# version @wasm-gaming/mgba-wasm@0.1.1 was built with is not recorded anywhere
# in the package or its repo, so there is no version to match. A different emsdk
# produces a different binary from the same sources, which is why the stage 1
# check is about behaviour and not about a hash. Pin this once a build is known
# good and byte reproducibility starts to matter.

STAGE="${1:-upstream}"
EMSDK_TAG="${EMSDK_TAG:-latest}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec docker run --rm \
	-v "${PROJECT_DIR}":/work \
	-w /work \
	-u "$(id -u):$(id -g)" \
	-e HOME=/tmp \
	"emscripten/emsdk:${EMSDK_TAG}" \
	bash scripts/build.sh "${STAGE}"
