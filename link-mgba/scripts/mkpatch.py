#!/usr/bin/env python3
"""Genera los parches de link-mgba/patches/ contra el commit pinado de mGBA.

No se escriben a mano. Cada punto de instrumentacion se ancla a un fragmento
del fuente original y se exige que ese fragmento sea unico: si upstream cambia
esa zona, esto falla en vez de producir un diff con contexto inventado que
luego no aplicaria.

    python3 scripts/mkpatch.py [directorio-de-salida]

Descarga los fuentes del commit pinado, asi que necesita red.
"""

import difflib
import pathlib
import sys
import urllib.request

MGBA_REF = "c034660f007c543233f1cadeb0ca13c71afd8f41"
RAW = "https://raw.githubusercontent.com/mgba-emu/mgba/" + MGBA_REF + "/"

OUT_DIR = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                       pathlib.Path(__file__).resolve().parent.parent / "patches")


def fetch(path):
    with urllib.request.urlopen(RAW + path, timeout=60) as response:
        return response.read().decode("utf-8")


def make(name, path, edits):
    original = fetch(path)
    text = original
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            raise SystemExit(f"{name}: ancla no unica ({n} coincidencias) en {path}:\n{old[:120]}")
        text = text.replace(old, new)

    diff = "".join(difflib.unified_diff(
        original.splitlines(keepends=True),
        text.splitlines(keepends=True),
        fromfile="a/" + path,
        tofile="b/" + path,
        n=3,
    ))
    target = OUT_DIR / name
    target.write_text(diff, encoding="utf-8", newline="")
    print(f"{target.name}: {len(edits)} punto(s) en {path}")


# --------------------------------------------------------------------------
# 0001 · savedata.c
#
# Las cuatro reservas anonimas del fichero y las dos ramas de
# GBASavedataDeinit, mas GBASavedataForceType, que por dentro hace Deinit+Init
# y puede mover el puntero entre una y otra.
# --------------------------------------------------------------------------
SAVEDATA = [
    (
        "void GBASavedataDeinit(struct GBASavedata* savedata) {\n\tif (savedata->vf) {",
        "void GBASavedataDeinit(struct GBASavedata* savedata) {\n"
        '\tmLOG(GBA_SAVE, WARN, "ML3DTRACE deinit-in sd=%p type=%i data=%p vf=%p", '
        "savedata, savedata->type, savedata->data, savedata->vf);\n"
        "\tif (savedata->vf) {",
    ),
    (
        "\t\tsavedata->vf = NULL;\n\t} else {\n\t\tswitch (savedata->type) {",
        '\t\tmLOG(GBA_SAVE, WARN, "ML3DTRACE deinit-unmap sd=%p data=%p", savedata, savedata->data);\n'
        "\t\tsavedata->vf = NULL;\n"
        "\t} else {\n"
        '\t\tmLOG(GBA_SAVE, WARN, "ML3DTRACE deinit-free sd=%p type=%i data=%p", '
        "savedata, savedata->type, savedata->data);\n"
        "\t\tswitch (savedata->type) {",
    ),
    (
        "void GBASavedataInitFlash(struct GBASavedata* savedata) {\n\tif (savedata->type == GBA_SAVEDATA_AUTODETECT) {",
        "void GBASavedataInitFlash(struct GBASavedata* savedata) {\n"
        '\tmLOG(GBA_SAVE, WARN, "ML3DTRACE flash-in sd=%p type=%i data=%p vf=%p", '
        "savedata, savedata->type, savedata->data, savedata->vf);\n"
        "\tif (savedata->type == GBA_SAVEDATA_AUTODETECT) {",
    ),
    (
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_FLASH1M);",
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_FLASH1M);\n"
        '\t\tmLOG(GBA_SAVE, WARN, "ML3DTRACE flash-alloc sd=%p data=%p size=%i", '
        "savedata, savedata->data, (int) GBA_SIZE_FLASH1M);",
    ),
    (
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_EEPROM);",
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_EEPROM);\n"
        '\t\tmLOG(GBA_SAVE, WARN, "ML3DTRACE eeprom-alloc sd=%p data=%p size=%i", '
        "savedata, savedata->data, (int) GBA_SIZE_EEPROM);",
    ),
    (
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_SRAM);",
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_SRAM);\n"
        '\t\tmLOG(GBA_SAVE, WARN, "ML3DTRACE sram-alloc sd=%p data=%p size=%i", '
        "savedata, savedata->data, (int) GBA_SIZE_SRAM);",
    ),
    (
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_SRAM512);",
        "\t\tsavedata->data = anonymousMemoryMap(GBA_SIZE_SRAM512);\n"
        '\t\tmLOG(GBA_SAVE, WARN, "ML3DTRACE sram512-alloc sd=%p data=%p size=%i", '
        "savedata, savedata->data, (int) GBA_SIZE_SRAM512);",
    ),
    (
        "void GBASavedataForceType(struct GBASavedata* savedata, enum GBASavedataType type) {\n\tif (savedata->type == type) {",
        "void GBASavedataForceType(struct GBASavedata* savedata, enum GBASavedataType type) {\n"
        '\tmLOG(GBA_SAVE, WARN, "ML3DTRACE forcetype sd=%p from=%i to=%i data=%p", '
        "savedata, savedata->type, type, savedata->data);\n"
        "\tif (savedata->type == type) {",
    ),
]

# --------------------------------------------------------------------------
# 0002 · platform/posix/memory.c
#
# El punto por el que pasan TODAS las reservas grandes de mGBA. Ojo con el
# fichero: src/util/memory.c NO se compila (su CMakeLists no lo lista); la raiz
# hace glob de src/platform/posix/*.c para UNIX, y Emscripten cumple if(UNIX).
# Este usa mmap/munmap, y munmap SI usa el tamano, asi que un tamano de
# liberacion distinto del de reserva no suelta el bloque.
#
# Se instrumentan las dos ramas, la de mmap y la de calloc, para que el mismo
# parche valga antes y despues de DISABLE_ANON_MMAP.
#
# printf en vez de mLOG: este fichero no declara categoria de log, y la salida
# acaba igualmente en Module.print, que es de donde la lee la prueba.
# --------------------------------------------------------------------------
MEMORY = [
    (
        "#include <mgba-util/memory.h>\n",
        "#include <mgba-util/memory.h>\n\n#include <stdio.h>\n",
    ),
    (
        "void* anonymousMemoryMap(size_t size) {\n"
        "\treturn mmap(0, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);\n"
        "}\n"
        "\n"
        "void mappedMemoryFree(void* memory, size_t size) {\n"
        "\tmunmap(memory, size);\n"
        "}",
        "void* anonymousMemoryMap(size_t size) {\n"
        "\tvoid* ptr = mmap(0, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);\n"
        '\tprintf("ML3DMAP alloc mmap ptr=%p size=%u\\n", ptr, (unsigned) size);\n'
        "\treturn ptr;\n"
        "}\n"
        "\n"
        "void mappedMemoryFree(void* memory, size_t size) {\n"
        '\tprintf("ML3DMAP free munmap ptr=%p size=%u\\n", memory, (unsigned) size);\n'
        "\tmunmap(memory, size);\n"
        "}",
    ),
    (
        "void* anonymousMemoryMap(size_t size) {\n"
        "\treturn calloc(1, size);\n"
        "}\n"
        "\n"
        "void mappedMemoryFree(void* memory, size_t size) {\n"
        "\tUNUSED(size);\n"
        "\tfree(memory);\n"
        "}",
        "void* anonymousMemoryMap(size_t size) {\n"
        "\tvoid* ptr = calloc(1, size);\n"
        '\tprintf("ML3DMAP alloc calloc ptr=%p size=%u\\n", ptr, (unsigned) size);\n'
        "\treturn ptr;\n"
        "}\n"
        "\n"
        "void mappedMemoryFree(void* memory, size_t size) {\n"
        '\tprintf("ML3DMAP free free ptr=%p size=%u\\n", memory, (unsigned) size);\n'
        "\tUNUSED(size);\n"
        "\tfree(memory);\n"
        "}",
    ),
]

if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make("0001-diag-savedata-trace.patch", "src/gba/savedata.c", SAVEDATA)
    make("0002-diag-mappedmemory-trace.patch", "src/platform/posix/memory.c", MEMORY)
