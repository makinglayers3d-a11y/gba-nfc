# link-mgba · fork controlado de mGBA-wasm

Zona de desarrollo del Cable Link sobre mGBA. El informe de diseño está en
[`../LINK-MGBA.md`](../LINK-MGBA.md); aquí solo está lo que se compila.

Nada de esto toca el emulador principal. `mgba-compat.js` sigue cargando el
paquete de jsdelivr y las páginas de `prototype/` se abren a mano.

## Estado

| Fase | Qué | Estado |
| --- | --- | --- |
| 1 | Reproducir el build oficial, shim original sin tocar | **scripts listos, sin compilar** |
| 2 | Shim multi-instancia con ROM compartida, sin cable | **escrito, sin compilar** |
| 3 | `GBASIOLockstepCoordinator` | no empezada |

Nada se ha compilado todavía: en el PC donde se escribió esto no hay `docker`,
`emcc`, `cmake`, `make` ni `node`. Hace falta uno de los dos caminos de abajo.

## Origen y licencia

| Fichero | Origen |
| --- | --- |
| `upstream/mgba_shim.c` | `scripts/shim/mgba_shim.c` de [wasm-gaming/mGBA-wasm](https://github.com/wasm-gaming/mGBA-wasm), copia literal |
| `upstream/build-mgba.sh` | `scripts/build-mgba.sh` del mismo repo, copia literal, solo como referencia |
| `shim/mgba_shim_multi.c` | derivado del anterior: multi-instancia y ROM compartida |
| `scripts/build.sh` | derivado de `upstream/build-mgba.sh` |

mGBA y mGBA-wasm son MPL-2.0, y los ficheros derivados también. Las copias
conservan su cabecera.

No es un `git submodule` a propósito: de ese repo solo necesitamos el script de
build y el shim. El SDK TypeScript, el manifest y la demo no los usamos, y un
submódulo obligaría a arrastrarlos y a resolver su `npm install`.

mGBA se clona en `.tmp/` durante el build (ignorado por git), pinado a
`c034660f007c543233f1cadeb0ca13c71afd8f41` — master, 2026-07-21, el commit del
que salió `@wasm-gaming/mgba-wasm@0.1.1`.

## Compilar

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
