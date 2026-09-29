#!/usr/bin/env bash
set -euo pipefail

# Checks that every EXPORT the shim declares survived into the linked glue, and
# that the artifacts look sane.
#
# The expected set is derived from the shim source rather than kept in a list
# beside it, because a hand-maintained list drifts and the invariant that
# matters is exactly "what the C declares is what JS can call". The failure this
# catches is an export silently dropped at link time.
#
# For the upstream stage it also compares against the published
# @wasm-gaming/mgba-wasm@0.1.1 glue: same stage, same shim, so the two export
# sets must be identical. That is the phase 1 reproduction check.
#
# Usage:  ./check-exports.sh [upstream|multi]

STAGE="${1:-upstream}"
case "${STAGE}" in
	upstream) SHIM_REL="upstream/mgba_shim.c" ;;
	multi)    SHIM_REL="shim/mgba_shim_multi.c" ;;
	*) echo "usage: $0 [upstream|multi]" >&2; exit 2 ;;
esac

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${PROJECT_DIR}/dist/${STAGE}"
GLUE="${OUT_DIR}/mgba.js"
WASM="${OUT_DIR}/mgba.wasm"
SHIM="${PROJECT_DIR}/${SHIM_REL}"

OFFICIAL_GLUE_URL="https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.js"
OFFICIAL_WASM_URL="https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.wasm"

fail() { echo "::error::$*"; exit 1; }

for f in "${GLUE}" "${WASM}" "${SHIM}"; do
	[ -f "${f}" ] || fail "no existe ${f}"
done

WASM_BYTES=$(wc -c < "${WASM}")
GLUE_BYTES=$(wc -c < "${GLUE}")

echo "=== Artefactos (fase ${STAGE}) ==="
printf 'mgba.wasm  %s bytes (%s KiB)\n' "${WASM_BYTES}" "$((WASM_BYTES / 1024))"
printf 'mgba.js    %s bytes (%s KiB)\n' "${GLUE_BYTES}" "$((GLUE_BYTES / 1024))"
echo

# --- exports declared vs exports linked ------------------------------------
EXPECTED=$(grep -oE '^EXPORT [A-Za-z_0-9* ]+ mgbawasm_[a-z0-9_]+\(' "${SHIM}" \
	| grep -oE 'mgbawasm_[a-z0-9_]+' | sort -u)
ACTUAL=$(grep -aoE '_mgbawasm_[a-z0-9_]+' "${GLUE}" | sed 's/^_//' | sort -u)

EXPECTED_N=$(printf '%s\n' "${EXPECTED}" | grep -c . || true)
ACTUAL_N=$(printf '%s\n' "${ACTUAL}" | grep -c . || true)

echo "=== Exports ==="
echo "declarados en ${SHIM_REL}: ${EXPECTED_N}"
echo "enlazados en mgba.js:      ${ACTUAL_N}"
echo

if [ "${EXPECTED_N}" -lt 20 ]; then
	fail "solo ${EXPECTED_N} exports declarados en el shim: el grep no esta leyendo bien el fuente"
fi

MISSING=$(comm -23 <(printf '%s\n' "${EXPECTED}") <(printf '%s\n' "${ACTUAL}") || true)
EXTRA=$(comm -13 <(printf '%s\n' "${EXPECTED}") <(printf '%s\n' "${ACTUAL}") || true)

if [ -n "${MISSING}" ]; then
	echo "Faltan en el enlazado:"
	printf '%s\n' "${MISSING}" | sed 's/^/  /'
	fail "el enlazador ha tirado $(printf '%s\n' "${MISSING}" | grep -c .) export(s)"
fi
if [ -n "${EXTRA}" ]; then
	echo "::warning::exports en mgba.js que el shim no declara:"
	printf '%s\n' "${EXTRA}" | sed 's/^/  /'
fi

printf '%s\n' "${ACTUAL}" | sed 's/^/  /'
echo

# --- lockstep: fuera en la fase 1, dentro en la 2+ -------------------------
# El objeto entra en libmgba.a de todas formas; lo que decide si acaba en el
# binario es que alguien lo referencie. En `upstream` nadie lo hace y su
# ausencia es la prueba de que el shim original no toca SIO. En `multi` el shim
# llama al coordinador, asi que su ausencia significaria que el enlazador lo ha
# tirado y el cable no existe.
if grep -aq 'GBA SIO Lockstep' "${WASM}"; then
	if [ "${STAGE}" = "upstream" ]; then
		fail "sio/lockstep.c esta enlazado en la fase 1, donde nadie deberia referenciarlo"
	fi
	echo "sio/lockstep.c: enlazado (correcto en la fase ${STAGE})"
else
	if [ "${STAGE}" != "upstream" ]; then
		fail "sio/lockstep.c NO esta enlazado: el cable no existe en este binario"
	fi
	echo "sio/lockstep.c: no enlazado (correcto en la fase 1)"
fi

# Control: sio.c must be there, or the grep above proves nothing.
grep -aq 'Could not initialize SIO driver' "${WASM}" \
	|| fail "sio.c no aparece en el binario: la comprobacion de cadenas no es fiable en este build"
echo "sio.c: presente (la busqueda de cadenas es fiable)"
echo

# --- phase 1 only: compare against the published artifacts ------------------
if [ "${STAGE}" = "upstream" ] && [ "${SKIP_OFFICIAL_DIFF:-0}" != "1" ]; then
	TMP="$(mktemp -d)"
	trap 'rm -rf "${TMP}"' EXIT
	if curl -sfL -m 120 -o "${TMP}/official.js" "${OFFICIAL_GLUE_URL}" \
		&& curl -sfL -m 180 -o "${TMP}/official.wasm" "${OFFICIAL_WASM_URL}"; then

		OFFICIAL=$(grep -aoE '_mgbawasm_[a-z0-9_]+' "${TMP}/official.js" | sed 's/^_//' | sort -u)
		OFFICIAL_WASM_BYTES=$(wc -c < "${TMP}/official.wasm")

		echo "=== Contra @wasm-gaming/mgba-wasm@0.1.1 ==="
		printf 'su mgba.wasm:      %s bytes\n' "${OFFICIAL_WASM_BYTES}"
		printf 'nuestro mgba.wasm: %s bytes (%+d)\n' \
			"${WASM_BYTES}" "$((WASM_BYTES - OFFICIAL_WASM_BYTES))"
		echo "Un tamano distinto es normal: otra version de emsdk da otro binario."

		DIFF_MISSING=$(comm -23 <(printf '%s\n' "${OFFICIAL}") <(printf '%s\n' "${ACTUAL}") || true)
		DIFF_EXTRA=$(comm -13 <(printf '%s\n' "${OFFICIAL}") <(printf '%s\n' "${ACTUAL}") || true)
		if [ -n "${DIFF_MISSING}" ] || [ -n "${DIFF_EXTRA}" ]; then
			[ -n "${DIFF_MISSING}" ] && { echo "Exports que tiene el oficial y nosotros no:"; printf '%s\n' "${DIFF_MISSING}" | sed 's/^/  /'; }
			[ -n "${DIFF_EXTRA}" ] && { echo "Exports que tenemos y el oficial no:"; printf '%s\n' "${DIFF_EXTRA}" | sed 's/^/  /'; }
			fail "la fase 1 debe exportar exactamente lo mismo que el paquete publicado"
		fi
		echo "Exports identicos al paquete publicado: ${ACTUAL_N}/${ACTUAL_N}"
	else
		echo "::warning::no se pudo descargar el paquete publicado; comparacion omitida"
	fi
	echo
fi

echo "check-exports: OK (fase ${STAGE})"
