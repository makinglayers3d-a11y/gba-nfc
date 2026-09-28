# link-mgba · fork controlado de mGBA-wasm

Zona de desarrollo del Cable Link sobre mGBA. El informe de diseño está en
[`../LINK-MGBA.md`](../LINK-MGBA.md); aquí solo está lo que se compila.

Nada de esto toca el emulador principal. `mgba-compat.js` sigue cargando el
paquete de jsdelivr y las páginas de `prototype/` se abren a mano.

## Estado

| Fase | Qué | Estado |
| --- | --- | --- |
| 1 | Reproducir el build oficial, shim original sin tocar | **en CI, pendiente de la primera ejecución** |
| 2 | Shim multi-instancia con ROM compartida, sin cable | escrita, se lanza a mano tras la fase 1 |
| 3 | `GBASIOLockstepCoordinator` | no empezada |

Nada se ha compilado todavía. El build va por GitHub Actions, no por el PC: en la
máquina donde se escribió esto no hay `docker`, `emcc`, `cmake`, `make` ni
`node`, y el sentido de hacerlo en CI es justo que eso deje de importar.

## Origen y licencia

| Fichero | Origen |
| --- | --- |
| `upstream/mgba_shim.c` | `scripts/shim/mgba_shim.c` de [wasm-gaming/mGBA-wasm](https://github.com/wasm-gaming/mGBA-wasm), copia literal |
| `upstream/build-mgba.sh` | `scripts/build-mgba.sh` del mismo repo, copia literal, solo como referencia |
| `shim/mgba_shim_multi.c` | derivado del anterior: multi-instancia y ROM compartida |
| `scripts/build.sh` | derivado de `upstream/build-mgba.sh` |
| `scripts/check-exports.sh` | nuestro: compara los `EXPORT` del shim con los que quedaron enlazados |
| `scripts/smoke.cjs` | nuestro: prueba headless en node, sin navegador |
| `patches/*.patch` | nuestros: se aplican sobre el commit pinado de mGBA, sin commitear |

## Parches sobre mGBA

**Ninguno.** `patches/` está vacío y el código de mGBA se compila tal cual sale
del commit pinado.

La infraestructura sigue ahí por si hiciera falta: `scripts/build.sh` hace
`reset --hard` al commit pinado y aplica encima, por orden alfabético, todo
`patches/*.patch`. Un parche que no aplica **para el build**: compilar en
silencio algo distinto de lo que dice el fichero es peor que no compilar. Como
no se commitean, `git rev-parse HEAD` dentro del checkout sigue siendo el commit
de upstream y el workflow imprime el `diff --stat` de lo que cambia encima.

`scripts/mkpatch.py` genera parches de instrumentación en `patches/diagnostics/`
—fuera de donde `build.sh` mira, para que no se apliquen sin querer— anclando
cada punto a un fragmento del fuente original y exigiendo que sea único: si
upstream cambia esa zona, falla en vez de producir un diff con contexto
inventado. Se usó para localizar la fuga de 128 KiB y se retiró después.

## La fuga de 128 KiB por núcleo

Cerrada con un define, sin tocar el código de mGBA. Vale la pena dejar escrito
el camino, porque la pista obvia era falsa.

`src/util/memory.c` tiene `anonymousMemoryMap` como `calloc` y
`mappedMemoryFree` como `free` ignorando el tamaño — y **no se compila**: su
propio `CMakeLists.txt` no lo lista. La raíz hace `file(GLOB OS_SRC
src/platform/posix/*.c)` para UNIX, condición que Emscripten cumple, así que el
que entra es `src/platform/posix/memory.c`:

```c
void* anonymousMemoryMap(size_t size) {
	return mmap(0, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
}
void mappedMemoryFree(void* memory, size_t size) {
	munmap(memory, size);
}
```

`munmap` **sí** usa el tamaño. `GBASavedataInitFlash` reserva siempre
`GBA_SIZE_FLASH1M` (128 KiB), y `GBASavedataDeinit` libera con
`GBA_SIZE_FLASH512` (64 KiB) cuando el cartucho se detecta como 512k. Ese
`munmap` parcial bajo Emscripten no libera nada.

Medido con la instrumentación: en un ciclo completo de un núcleo había
**exactamente una** liberación con tamaño distinto del de su reserva y **cero**
reservas sin liberar. Todas las demás (608, 6 752, 294 912 de EWRAM+IWRAM,
98 304 de VRAM) cuadraban en puntero y tamaño.

El arreglo es `-DDISABLE_ANON_MMAP` en `build.sh`: es la configuración que el
propio mGBA usa bajo AddressSanitizer, cambia las dos funciones a `calloc`/`free`
—donde el tamaño de la liberación se ignora— y con eso el desajuste deja de
importar aquí y en cualquier otro sitio donde pudiera existir. Bajo Emscripten
el `mmap` anónimo no aporta nada frente a `calloc`.

mGBA y mGBA-wasm son MPL-2.0, y los ficheros derivados también. Las copias
conservan su cabecera.

No es un `git submodule` a propósito: de ese repo solo necesitamos el script de
build y el shim. El SDK TypeScript, el manifest y la demo no los usamos, y un
submódulo obligaría a arrastrarlos y a resolver su `npm install`.

mGBA se clona en `.tmp/` durante el build (ignorado por git), pinado a
`c034660f007c543233f1cadeb0ca13c71afd8f41` — master, 2026-07-21, el commit del
que salió `@wasm-gaming/mgba-wasm@0.1.1`.

## Compilar

### GitHub Actions — el build oficial

`.github/workflows/build-mgba-link.yml`, solo en esta rama. Es el camino
reproducible: no depende de lo que haya instalado en ningún PC.

Se lanza desde Actions → **Build mGBA Link core** → *Run workflow*, con cuatro
entradas:

| Entrada | Por defecto | Para qué |
| --- | --- | --- |
| `stage` | `upstream` | `upstream` = fase 1, `multi` = fase 2 |
| `emsdk_tag` | `latest` | Etiqueta de `emscripten/emsdk`. Pinar en cuanto haya un build bueno |
| `smoke_seconds` | `60` | Duración de la prueba de estabilidad de la fase 2 |
| `rom` | `games/Mario Kart - Super Circuit.gba` | ROM de la prueba headless |

También corre solo al empujar cambios en `link-mgba/**`, y ahí siempre en fase
`upstream`: la fase 2 hay que pedirla a mano.

Qué hace el job, en orden: checkout disperso (solo `link-mgba` y una ROM —
`games/` pesa 577 MB), build con el commit de mGBA pinado, comprobación de que
el `HEAD` clonado es ese commit, verificación de exports, prueba headless en
node, resumen con el tamaño del `.wasm` y artifact `mgba-<fase>-<run>` con
`mgba.js` y `mgba.wasm`.

Falla si el build falla, si el commit no coincide, si el enlazador ha tirado
algún export, si la fase 1 no exporta exactamente lo mismo que el paquete
publicado, o si la prueba headless no pasa.

`emsdk_tag: latest` es deliberado de momento: la versión de emsdk con la que se
construyó `@wasm-gaming/mgba-wasm@0.1.1` no está registrada en ninguna parte del
paquete ni de su repo, así que no hay versión que igualar. El log imprime
`emcc --version`; con eso se pina y a partir de ahí el build es byte a byte.

### Con Docker (recomendado: no instala nada en el PC)

```bash
cd link-mgba
bash scripts/build-docker.sh upstream   # fase 1
bash scripts/build-docker.sh multi      # fase 2
```

Necesita Docker Desktop corriendo. La imagen `emscripten/emsdk` ya trae emcc,
cmake, node, python y git.

### Con emsdk local

```bash
cd link-mgba
bash scripts/build.sh upstream
bash scripts/build.sh multi
```

Necesita `emcmake`/`emcc` en el PATH, más `cmake`, `make` y `git`. En Windows,
desde Git Bash con el emsdk activado.

La salida va a `dist/upstream/` y `dist/multi/` (ignoradas por git: son
artefactos, y el `.wasm` pesa cerca de 1 MB).

Variables útiles:

| Variable | Para qué |
| --- | --- |
| `MGBA_REF` | otro commit de mGBA |
| `MGBA_OPT` | `-O0 -g` para depurar |
| `MGBA_ASSERTS=1` | no pasar `-DNDEBUG`: deja vivos los `mASSERT` del lockstep. Obligatorio en la fase 3 |
| `MGBA_JOBS` | paralelismo |
| `EMSDK_TAG` | otra etiqueta de la imagen de Docker |

## Probar

### Sin navegador (lo que corre en CI)

```bash
node scripts/smoke.cjs upstream                      # fase 1
SMOKE_SECONDS=180 node scripts/smoke.cjs multi       # fase 2
```

El glue se enlaza con `-sENVIRONMENT=web,node`, así que node carga el mismo
artefacto que sube el artifact. Lo que mide cada fase:

| Fase 1 | Fase 2 |
| --- | --- |
| `mgbawasm_load` devuelve 1 | heap con 0 núcleos, con ROM, con 1 y con 2 |
| plataforma detectada como GBA | abre el núcleo 0 y el núcleo 1 |
| sample rate y framerate reales | el 2.º núcleo no duplica la ROM |
| 600 frames sin atascarse | frames idénticos sin entrada (determinismo) |
| 240x160 con imagen de verdad | pantallas distintas al pulsar solo en uno |
| el núcleo produce audio | punteros de framebuffer distintos |
| | estabilidad N segundos, sin fugas de heap |
| | cerrar, reabrir y volver al punto de partida |

### En el navegador

Las dos páginas necesitan servidor (cargan módulos ES y hacen `fetch`). Vale el
del repo: `probar-lobby-local.cmd` o `powershell -ExecutionPolicy Bypass -File
dev-server.ps1`, y luego:

| Página | Fase | Qué demuestra |
| --- | --- | --- |
| `http://localhost:8765/link-mgba/prototype/stage1-drop-in.html` | 1 | Nuestro WASM con el SDK oficial, la misma ruta que `mgba-compat.js`. Hay una casilla para alternar con el WASM de jsdelivr y comparar |
| `http://localhost:8765/link-mgba/prototype/two-cores.html` | 2 | Dos `mCore` en un módulo, ROM compartida, teclas separadas, memoria medida |

`two-cores.html` mide la memoria con `mgbawasm_heap_used()`, que devuelve
`mallinfo().uordblks` — bytes realmente entregados por `malloc`. `HEAPU8.length`
solo dice cuánta memoria lineal hay reservada, y con
`ALLOW_MEMORY_GROWTH` eso queda muy por encima de lo que se usa.

Criterio de la fase 2: abrir el segundo núcleo sube el heap en ~1 MiB, **no** en
el tamaño de la ROM, y los dos canvas divergen al pulsar teclas distintas.

## Qué añade `shim/mgba_shim_multi.c`

Respecto al shim original, tres cosas y ninguna más:

1. **Multi-instancia.** Los `static` globales pasan a `struct Instance
   instances[4]` y cada export lleva un `id` delante.
2. **ROM compartida.** `mgbawasm_rom_share()` copia la imagen una vez; cada
   instancia envuelve ese mismo buffer en su propio `VFile`. Cuatro copias de un
   cartucho de 16 MiB serían 64 MiB tirados.
3. **Dos exports de servicio.** `mgbawasm_drop_audio(id)` vacía el buffer de las
   consolas que no suenan, y `mgbawasm_heap_used()` mide.

Exports nuevos:

```
mgbawasm_rom_share(rom, bytes)      mgbawasm_instance_open(platform, gbModel, skipBios) -> id
mgbawasm_bios_share(bios, bytes)    mgbawasm_instance_close(id)
mgbawasm_rom_release()              mgbawasm_instance_count()
mgbawasm_rom_size()                 mgbawasm_instance_max()
mgbawasm_drop_audio(id)             mgbawasm_heap_used()
```

De los 25 originales, 23 siguen ahí con la misma semántica y solo con el `id`
delante. Los dos que desaparecen son `mgbawasm_load` y `mgbawasm_unload`: su
trabajo lo hacen `rom_share` + `instance_open` / `instance_close`. Mantener
además el camino de ROM privada sería un segundo camino que nadie usa.

Total: 33 exports. Los cuenta `scripts/build.sh` al terminar, así que el build
mismo dice si el enlazado los dejó todos.

Nada de SIO todavía. El coordinador entra en la fase 3 y no antes de que la 2
esté demostrada.
