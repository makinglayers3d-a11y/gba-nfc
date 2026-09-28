#!/usr/bin/env bash
set -euo pipefail

# Build mGBA to WebAssembly for the ML3D Cable Link prototype.
#
# Derived from scripts/build-mgba.sh of github.com/wasm-gaming/mGBA-wasm
# (MPL-2.0). Two deliberate changes and nothing else:
#
#  * it takes a stage argument, so the same flags can link either the upstream
#    single-instance shim (stage 1, the reproduction check) or ours (stage 2);
#  * output goes to link-mgba/dist/<stage>/ instead of dist/mgba/.
#
# Everything about the CMake configuration is left alone on purpose. It is what
# produces the binary we already ship, and the point of stage 1 is to show that
# building it ourselves changes nothing.
#
# Usage:  ./build.sh [upstream|multi]      (default: upstream)
# Needs:  emsdk on PATH (emcmake, emcc), cmake, make, git.
#         Use scripts/build-docker.sh if you would rather not install them.

STAGE="${1:-upstream}"
case "${STAGE}" in
	upstream) SHIM_REL="upstream/mgba_shim.c" ;;
	multi)    SHIM_REL="shim/mgba_shim_multi.c" ;;
	*) echo "usage: $0 [upstream|multi]" >&2; exit 2 ;;
esac

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${PROJECT_DIR}/.tmp/mgba-build"
CMAKE_DIR="${PROJECT_DIR}/.tmp/mgba-cmake"
OUT_DIR="${PROJECT_DIR}/dist/${STAGE}"
SHIM="${PROJECT_DIR}/${SHIM_REL}"

MGBA_REPO="${MGBA_REPO:-https://github.com/mgba-emu/mgba.git}"
# The commit @wasm-gaming/mgba-wasm@0.1.1 was built from: mgba master,
# 2026-07-21. Pinned, not tracked: GBASIOLockstepCoordinator is recent code and
# a moving target would change the API under the link work.
MGBA_REF="${MGBA_REF:-c034660f007c543233f1cadeb0ca13c71afd8f41}"

OPT="${MGBA_OPT:--O3}"
# Stage 3 will want the coordinator's own invariant checks, which -DNDEBUG
# removes. Set MGBA_ASSERTS=1 to keep them.
ASSERTS="${MGBA_ASSERTS:-0}"
JOBS="${MGBA_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

mkdir -p "${BUILD_DIR}" "${OUT_DIR}"

# --- Fetch pinned source ----------------------------------------------------
if [ ! -d "${BUILD_DIR}/.git" ]; then
	echo "Init mGBA checkout..."
	git init --quiet "${BUILD_DIR}"
	git -C "${BUILD_DIR}" remote add origin "${MGBA_REPO}"
fi
# Only the pinned commit, shallow: mGBA's full history is a few hundred MB and
# nothing here reads it. Servers that refuse a bare SHA fall back to a full
# fetch. version.cmake's `git describe` finds no tags in a shallow checkout and
# leaves the version string empty, which it already handles for tarball builds.
git -C "${BUILD_DIR}" fetch --quiet --depth 1 origin "${MGBA_REF}" \
	|| git -C "${BUILD_DIR}" fetch --quiet origin
git -C "${BUILD_DIR}" checkout --quiet "${MGBA_REF}"
# El checkout esta cacheado entre runs y los parches se aplican encima, asi que
# hay que volver al commit limpio antes de aplicarlos o la segunda vez fallarian
# por estar ya puestos.
git -C "${BUILD_DIR}" reset --hard --quiet "${MGBA_REF}"
git -C "${BUILD_DIR}" clean -fdq
echo "mGBA at $(git -C "${BUILD_DIR}" rev-parse HEAD)"

# --- Parches propios --------------------------------------------------------
# El commit de mGBA se queda como esta y lo nuestro va encima, en patches/, en
# orden alfabetico. Un parche que no aplica para el build: mejor eso que
# compilar en silencio algo distinto de lo que el fichero dice.
PATCH_DIR="${PROJECT_DIR}/patches"
if [ -d "${PATCH_DIR}" ] && ls "${PATCH_DIR}"/*.patch >/dev/null 2>&1; then
	for patch in "${PATCH_DIR}"/*.patch; do
		name="$(basename "${patch}")"
		if ! git -C "${BUILD_DIR}" apply --check "${patch}" 2>/dev/null; then
			echo "::error::el parche ${name} no aplica sobre ${MGBA_REF}" >&2
			git -C "${BUILD_DIR}" apply --check "${patch}" >&2 || true
			exit 1
		fi
		git -C "${BUILD_DIR}" apply "${patch}"
		echo "Parche aplicado: ${name}"
	done
else
	echo "Sin parches propios."
fi

# --- Configure --------------------------------------------------------------
# From upstream's script, plus one define of our own. The first two are what its
# CMakeLists does not do for Emscripten:
#
#  * _GNU_SOURCE — Emscripten satisfies if(UNIX) but is not "Linux", the only
#    branch that defines it. Without it, -std=c11 hides strdup and strlcpy.
#  * DISABLE_THREADING — the same if(UNIX) branch force-enables USE_PTHREADS,
#    overriding it on the command line. Single-threaded: no SharedArrayBuffer,
#    no COOP/COEP requirement. It is also what makes Mutex a no-op, which is
#    what lets GBASIOLockstepCoordinator run cooperatively in stage 3.
#  * DISABLE_ANON_MMAP — ours. Fixes a 128 KiB leak per core, measured.
#    Emscripten satisfies if(UNIX), so the memory backend that gets compiled is
#    src/platform/posix/memory.c, which is mmap/munmap — not the calloc/free of
#    src/util/memory.c, which its own CMakeLists does not even list. munmap uses
#    the size it is given. Flash savedata is always allocated as
#    GBA_SIZE_FLASH1M (128 KiB) but freed as GBA_SIZE_FLASH512 (64 KiB) when the
#    cartridge detects as 512k, and a partial munmap under Emscripten releases
#    nothing at all. This define is mGBA's own AddressSanitizer configuration
#    and swaps both functions to calloc/free, where the size passed to the free
#    is ignored, so the mismatch stops mattering here and anywhere else it might
#    exist. Under Emscripten anonymous mmap buys nothing over calloc anyway.
echo "Configuring mGBA (emcmake)..."
emcmake cmake \
	-S "${BUILD_DIR}" \
	-B "${CMAKE_DIR}" \
	-DCMAKE_BUILD_TYPE=Release \
	-DCMAKE_C_FLAGS="${OPT} -D_GNU_SOURCE -DDISABLE_THREADING -DDISABLE_ANON_MMAP" \
	-DBUILD_STATIC=ON \
	-DBUILD_SHARED=OFF \
	-DDISABLE_FRONTENDS=ON \
	-DDISABLE_DEPS=ON \
	-DBUILD_QT=OFF \
	-DBUILD_SDL=OFF \
	-DBUILD_LIBRETRO=OFF \
	-DBUILD_TEST=OFF \
	-DBUILD_SUITE=OFF \
	-DBUILD_GL=OFF \
	-DBUILD_GLES2=OFF \
	-DBUILD_GLES3=OFF \
	-DUSE_PTHREADS=OFF \
	-DUSE_ZLIB=OFF \
	-DUSE_MINIZIP=OFF \
	-DUSE_LIBZIP=OFF \
	-DUSE_PNG=OFF \
	-DUSE_SQLITE3=OFF \
	-DUSE_FFMPEG=OFF \
	-DUSE_ELF=OFF \
	-DUSE_LZMA=OFF \
	-DUSE_LUA=OFF \
	-DUSE_JSON_C=OFF \
	-DUSE_FREETYPE=OFF \
	-DUSE_EDITLINE=OFF \
	-DUSE_DISCORD_RPC=OFF \
	-DUSE_EPOXY=OFF \
	-DENABLE_SCRIPTING=OFF \
	-DENABLE_DEBUGGERS=OFF \
	> /dev/null

# MINIMAL_CORE stays off (it is only forced on for CMAKE_SYSTEM_NAME "Generic"),
# which is what puts GBA_SIO_SRC — src/gba/sio/lockstep.c — into libmgba.a. It
# is in the archive either way; the linker drops it until the shim references a
# symbol from it, which is why the published 0.1.1 wasm carries none of it.
echo "Building libmgba.a..."
cmake --build "${CMAKE_DIR}" --target mgba -j "${JOBS}"

LIB="$(find "${CMAKE_DIR}" -name 'libmgba.a' -print -quit)"
if [ -z "${LIB}" ]; then
	echo "error: libmgba.a not produced by the CMake build" >&2
	exit 1
fi

# --- Link the shim ----------------------------------------------------------
# The shim must see the exact same preprocessor defines libmgba.a was built
# with, because struct mCore changes shape with them: ENABLE_VFS plus
# ENABLE_DIRECTORIES insert an mDirectorySet early in the struct, and
# MINIMAL_CORE removes an mInputMap. Get one wrong and every function pointer
# past that field is read from the wrong offset — the failure is a "null
# function or function signature mismatch" at the first core->init(), nowhere
# near the cause.
#
# So they are not restated here: they are lifted from the flags CMake actually
# used. Do not replace this with a hand-written list.
FLAGS_MAKE="${CMAKE_DIR}/CMakeFiles/mgba.dir/flags.make"
if [ ! -f "${FLAGS_MAKE}" ]; then
	echo "error: ${FLAGS_MAKE} not found — cannot mirror libmgba's defines" >&2
	exit 1
fi
CORE_DEFINES=()
while read -r define; do
	CORE_DEFINES+=("${define}")
done < <(grep -m1 '^C_DEFINES' "${FLAGS_MAKE}" | cut -d= -f2- | tr ' ' '\n' | grep '^-D')

echo "Mirroring libmgba defines: ${CORE_DEFINES[*]}"

CFLAGS=(
	"${OPT}"
	-std=gnu11
	-I"${BUILD_DIR}/include"
	-I"${CMAKE_DIR}/include"
	-D_GNU_SOURCE
	-DDISABLE_THREADING
	-DDISABLE_ANON_MMAP
	"${CORE_DEFINES[@]}"
	-Wno-deprecated-declarations
)
if [ "${ASSERTS}" = "1" ]; then
	echo "Asserts: ON (no -DNDEBUG)"
else
	CFLAGS+=(-DNDEBUG)
fi

LDFLAGS=(
	"${OPT}"
	--no-entry
	-sMODULARIZE=1
	-sEXPORT_NAME=createMgbaModule
	-sENVIRONMENT=web,node
	-sALLOW_MEMORY_GROWTH=1
	-sINITIAL_MEMORY=67108864    # 64MB: 32MB carts plus savestate scratch
	-sMAXIMUM_MEMORY=536870912
	-sSTACK_SIZE=1048576
	# FILESYSTEM stays enabled: mGBA's VFS layer is compiled in (ENABLE_VFS is
	# forced ON by its CMakeLists and cannot be turned off from the outside),
	# so the stdio calls it makes need something real behind them even though
	# every asset this port loads travels through memory.
	-sEXPORTED_FUNCTIONS=_malloc,_free
	# HEAP32 es nuestro: los estados del cable llevan enteros con signo, y el
	# asiento sin confirmar es -1.
	-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16,HEAP32,HEAPU32,UTF8ToString,stringToUTF8,lengthBytesUTF8
)

echo "Linking ${SHIM_REL} + libmgba with emcc..."
emcc \
	"${CFLAGS[@]}" \
	"${SHIM}" \
	"${LIB}" \
	"${LDFLAGS[@]}" \
	-o "${OUT_DIR}/mgba.js"

echo
echo "Built artifacts:"
ls -l "${OUT_DIR}/mgba.js" "${OUT_DIR}/mgba.wasm"

# Fails the build when the linker dropped an export the shim declares. Same
# script CI runs, so a green build locally means the same thing there.
bash "$(dirname "${BASH_SOURCE[0]}")/check-exports.sh" "${STAGE}"
