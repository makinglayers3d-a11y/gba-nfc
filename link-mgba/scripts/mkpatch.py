import difflib, sys, pathlib

SRC = pathlib.Path(sys.argv[1])          # copia literal de src/gba/savedata.c
OUT = pathlib.Path(sys.argv[2])          # .patch resultante

original = SRC.read_text(encoding="utf-8", newline="")
text = original

LOG = 'mLOG(GBA_SAVE, WARN, "ML3DTRACE %s", %s);'

edits = [
    # Deinit: entrada y las dos ramas, para ver cual se toma y con que puntero.
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
    # InitFlash: entrada (con el data que YA hubiera) y la reserva.
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
    # Las otras reservas anonimas, por si los 128 KiB no fueran los del flash.
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
    # ForceType: hace Deinit + Init por dentro, asi que puede mover el puntero.
    (
        "void GBASavedataForceType(struct GBASavedata* savedata, enum GBASavedataType type) {\n\tif (savedata->type == type) {",
        "void GBASavedataForceType(struct GBASavedata* savedata, enum GBASavedataType type) {\n"
        '\tmLOG(GBA_SAVE, WARN, "ML3DTRACE forcetype sd=%p from=%i to=%i data=%p", '
        "savedata, savedata->type, type, savedata->data);\n"
        "\tif (savedata->type == type) {",
    ),
]

for old, new in edits:
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"ancla no unica ({n} coincidencias):\n{old[:120]}")
    text = text.replace(old, new)

diff = difflib.unified_diff(
    original.splitlines(keepends=True),
    text.splitlines(keepends=True),
    fromfile="a/src/gba/savedata.c",
    tofile="b/src/gba/savedata.c",
    n=3,
)
OUT.write_text("".join(diff), encoding="utf-8", newline="")
print(f"{OUT}: {len(edits)} puntos instrumentados")
