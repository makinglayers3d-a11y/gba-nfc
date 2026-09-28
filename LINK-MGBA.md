# Cable Link sobre mGBA

Rama de desarrollo `test/mgba-link-2026-09-26`, partida de `main` en `9d251e0`.

Objetivo: quitar IodineGBA también del Cable Link y quedarnos con un solo
núcleo. Hoy `main` usa mGBA para la partida normal y deja IodineGBA solo cuando
hay sesión Link (`app.js`, `shouldUseMgbaCompat()`), así que son dos núcleos.

Este documento es el informe de viabilidad. Todo lo que afirma está comprobado
contra el código real de mGBA en el commit que usamos y contra el `.wasm`
publicado, no de memoria. Los comandos para repetir las comprobaciones están al
final.

## Estado

El código del prototipo vive en [`link-mgba/`](link-mgba/README.md), aislado: el
emulador principal y `mgba-compat.js` no se tocan.

| Fase | Qué | Estado |
| --- | --- | --- |
| 1 | Reproducir el build oficial con el shim original | **validada** (run 3) |
| 2 | Shim multi-instancia con ROM compartida, sin cable | **validada** (run 5) |
| 3 | `GBASIOLockstepCoordinator` | en curso: 2 consolas en el mismo modulo |

Los números están en «Resultados medidos».

El build oficial del fork es
[`.github/workflows/build-mgba-link.yml`](.github/workflows/build-mgba-link.yml),
solo en esta rama: compila en un contenedor `emscripten/emsdk`, verifica el
commit pinado y los exports, corre una prueba headless en node y sube
`mgba.js` + `mgba.wasm` como artifact. Así el build no depende de lo que haya
instalado en ningún PC, que es justo lo que se buscaba.

## Resultados medidos

Todo lo de esta sección sale de ejecuciones reales del workflow, no de
estimaciones. La ROM de prueba es Mario Kart Super Circuit (4 MiB).

### Tamaños

| Binario | Bytes | Contra el publicado |
| --- | --- | --- |
| `mgba.wasm` fase 1 (shim original) | 807 995 | −1 650 (−0,20 %) |
| `mgba.wasm` fase 2 (shim multi) | 809 144 | −501 (−0,06 %) |
| `@wasm-gaming/mgba-wasm@0.1.1` | 809 645 | — |

El shim multi-instancia cuesta 1 149 bytes sobre el de una instancia. La
diferencia con el publicado es la huella de otra versión de emsdk; por eso el
criterio de la fase 1 es de comportamiento y de exports, no de hash.

### Fase 1 — el build propio se comporta como el publicado

Run 3, commit `a10204b`. Siete comprobaciones, todas pasadas.

- Exports **idénticos uno a uno** a los del paquete publicado.
- `sio/lockstep.c` fuera del binario, con `sio.c` presente como control de que
  la búsqueda de cadenas es fiable en ese build.
- Arranca un cartucho real: plataforma GBA, 600 frames sin atascarse, 240×160
  con imagen, y audio.
- Sample rate 32 768 Hz y framerate 59,7275 Hz, ambos derivados del reloj del
  núcleo.
- Memoria lineal 64,00 MiB antes y después de cargar la ROM: `INITIAL_MEMORY`
  ya reserva eso y un cartucho de 4 MiB cabe sin crecer.

### Fase 2 — dos núcleos en un módulo, con la ROM compartida

Run 5, commit `0fd07f6`, `smoke_seconds=180`. **19 de 19 comprobaciones
pasadas**, job en verde en 3 m 46 s.

**Memoria**

| Momento | Heap en uso | Incremento |
| --- | --- | --- |
| 0 núcleos, sin ROM | 0,00 MiB | — |
| ROM compartida cargada (4 MiB) | 4,00 MiB | +4,00 |
| 1 núcleo | 4,92 MiB | +0,92 |
| 2 núcleos | 5,85 MiB | +0,93 |

**Coste real por núcleo: 0,92 MiB.** La estimación de diseño de este documento
era ~1 MiB por instancia sin ROM, así que se sostiene.

**La ROM se comparte de verdad.** Es el dato más limpio del run: el segundo
núcleo cuesta 0,92 MiB frente a los 4,00 MiB del cartucho. Con copias privadas
habría costado 4 MiB. Extrapolando a una sala llena con Pokémon Esmeralda
(16 MiB): ~19,7 MiB en vez de ~68 MiB.

**Determinismo e independencia**

- Tras 600 frames sin entrada, los dos framebuffers son **idénticos byte a
  byte**. No es solo que no se estorben: es que son deterministas, que es el
  requisito real del lockstep de la fase 3.
- Pulsando START solo en el núcleo 1 durante 900 frames, las dos pantallas
  divergen. La entrada de un núcleo no llega al otro.
- Cada núcleo tiene su framebuffer en una dirección distinta.

**Audio**

- El núcleo visible produce muestras.
- `mgbawasm_drop_audio` vacía exactamente lo que había y deja la cola a cero.
- Un núcleo al que **nadie** le drena el audio avanza los 300 frames completos.
  Su cola se queda en 16 384 muestras, que es exactamente el `0x4000` que fija
  `setAudioBufferSize`: el buffer satura y descarta, no bloquea al núcleo.

Eso cierra el riesgo «audio de las consolas ocultas» que aparece más abajo: las
tres consolas mudas de una sala de cuatro son seguras.

**Estabilidad, 180 s con los dos núcleos**

| Medida | Valor |
| --- | --- |
| Frames por núcleo | 91 800 |
| fps por núcleo, sin limitar el reloj | 509,9 |
| Heap mínimo / máximo | 6,10 MiB / 6,10 MiB |
| **Recorrido del heap** | **0,00 MiB** sobre 18 muestras |
| Memoria lineal antes / después | 64,00 MiB / 64,00 MiB |

419 fps por núcleo con dos a la vez son unas 7 veces el tiempo real por núcleo
en la máquina de CI. Es holgura, no un número de móvil, pero el heap
perfectamente plano sobre 75 480 frames dice que en el bucle de ejecución no hay
fuga.

**Sin ruido**

Cero líneas de log del núcleo. Con `logLevel 1` pasan FATAL, ERROR y WARN, así
que mGBA no se quejó de nada en todo el run. Sin crashes. La única anotación del
job es la de plataforma sobre Node 20 en las acciones `@v4`, ajena a este código.

**Residuo al cerrar — era una fuga, y está cerrada**

Lo que la primera pasada dejó abierto: tras cerrar los dos núcleos y soltar la
ROM quedaban 0,25 MiB contra los 0,00 iniciales. El experimento
(`SMOKE_MODE=leak`) lo convirtió en un diagnóstico y no en una sospecha.

| Medida | Resultado |
| --- | --- |
| 1 / 2 / 3 / 4 núcleos con frames | 128 / 256 / 384 / 512 KiB |
| 1 / 2 / 3 / 4 núcleos **sin** frames | 0 KiB en los cuatro |
| 2 núcleos, 1 800 frames vs 3 600 | 256 KiB en ambos |
| 1 / 2 / 4 / 8 reaperturas del mismo asiento | 128 / 256 / 512 / **1 024 KiB** |

O sea: 128 KiB por núcleo que haya ejecutado, independiente del tiempo de
ejecución, y **sin reaprovechar el hueco al reabrir**. Eso último es lo que lo
convertía en fuga de verdad: una sesión larga crece sin techo.

*La causa, que no era la obvia.* `src/util/memory.c` define
`anonymousMemoryMap` como `calloc` y `mappedMemoryFree` como `free` ignorando el
tamaño — y **no se compila**: su `CMakeLists.txt` no lo lista. La raíz hace glob
de `src/platform/posix/*.c` para UNIX, condición que Emscripten cumple, y ese
usa `mmap`/`munmap`. `munmap` **sí** usa el tamaño, y `GBASavedataInitFlash`
reserva siempre `GBA_SIZE_FLASH1M` (128 KiB) mientras `GBASavedataDeinit` libera
con `GBA_SIZE_FLASH512` (64 KiB) cuando el cartucho se detecta como 512k. El
`munmap` parcial bajo Emscripten no libera nada.

Instrumentando todas las reservas anónimas salió limpio: en un ciclo completo de
un núcleo, **una** liberación con tamaño distinto del de su reserva y **cero**
reservas sin liberar.

*El arreglo:* `-DDISABLE_ANON_MMAP` en `build.sh`. Sin parche al código de mGBA
— es su propia configuración de AddressSanitizer, cambia ambas funciones a
`calloc`/`free`, donde el tamaño de la liberación se ignora, y bajo Emscripten
el `mmap` anónimo no aporta nada frente a `calloc`.

*Después del arreglo,* revalidación completa con el mismo experimento:

| Medida | Antes | Después |
| --- | --- | --- |
| 1 / 2 / 3 / 4 núcleos con frames | 128 / 256 / 384 / 512 KiB | **0 / 0 / 0 / 0** |
| 1 / 2 / 4 / 8 reaperturas | 128 / 256 / 512 / 1 024 KiB | **0 / 0 / 0 / 0** |
| 2 núcleos, 1 800 vs 3 600 frames | 256 KiB en ambos | **0 en ambos** |
| Peor residuo de todo el experimento | 1 024 KiB | **0 KiB** |
| Primer frame con residuo | 30 | **nunca** |
| Heap tras cerrar los dos (ROM viva) | 4,25 MiB | **4,00 MiB**, la ROM exacta |
| Heap tras `rom_release` | 0,25 MiB | **0,00 MiB**, la línea base exacta |

El guardado sigue funcionando: la savedata de un núcleo que ha corrido sigue
apareciendo en el frame 30 y sigue midiendo 64 KiB. Lo único que cambia es que
ahora se libera.

**Sample rate entre fases.** La fase 1 mide 32 768 Hz y la fase 2 mide
65 536 Hz. Es correcto y no es un fallo: la fase 1 lee justo tras el reset y la
fase 2 tras ~1 500 frames de juego. El GBA sube la resolución de audio por
`SOUNDBIAS` sobre la marcha y mGBA reporta la del momento.

## Punto de partida

| Pieza | Estado en `main` |
| --- | --- |
| Partida normal GBA/GB/GBC | mGBA vía `mgba-compat.js` |
| Cable Link | IodineGBA (`user_scripts/LocalLinkSession.js` + `IodineGBA/core/Serial.js`) |
| Lobby, WebRTC, salas, asientos, reparto de ROM | Independientes del núcleo |

`mgba-compat.js` carga `@wasm-gaming/mgba-wasm@0.1.1` desde jsdelivr:

```
SDK_URL   = https://esm.sh/@wasm-gaming/mgba-wasm@0.1.1?bundle
CORE_JS   = https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.js
CORE_WASM = https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.wasm
```

## Commit exacto de mGBA

El paquete no fija la versión en su `package.json`: la fija su script de build,
`scripts/build-mgba.sh` del repo `github.com/wasm-gaming/mGBA-wasm`.

```
MGBA_REPO = https://github.com/mgba-emu/mgba.git
# mgba master, 2026-07-21
MGBA_REF  = c034660f007c543233f1cadeb0ca13c71afd8f41
```

Ese commit es posterior a la reescritura del lockstep SIO, así que trae
`GBASIOLockstepCoordinator` (2-4 consolas, cola de eventos por jugador,
serialización en savestate) y no el `GBASIOLockstepNode` viejo de dos.

Cualquier trabajo de esta rama se pina a ese commit. Subirlo es una decisión
aparte y con su propia validación.

## Limitaciones del WASM actual

El artefacto publicado (`mgba.wasm`, 809 645 bytes) tiene tres límites que
bloquean el Link, en orden de importancia.

### 1. El lockstep no está dentro del binario

No es que esté compilado y sin exportar: no está. Prueba sobre el binario
publicado, buscando cadenas literales de cada fichero fuente:

| Cadena | Fichero de origen | Ocurrencias en `mgba.wasm` |
| --- | --- | --- |
| `All players acked` | `src/gba/sio/lockstep.c` | 0 |
| `Aborting in-progress transfer` | `src/gba/sio/lockstep.c` | 0 |
| `GBA SIO Lockstep` | `src/gba/sio/lockstep.c` | 0 |
| `Could not initialize SIO driver` | `src/gba/sio.c` | 1 |
| `GBA SIO Complete` | `src/gba/sio.c` | 1 |
| `JOY write: CNT` | `src/gba/sio.c` | 1 |

`sio.c` sí está; `sio/lockstep.c` no.

Sí entra en `libmgba.a`: `src/gba/CMakeLists.txt` lo pone en `SIO_FILES` →
`GBA_SIO_SRC`, y el `CMakeLists.txt` raíz lo añade a `SRC` cuando
`NOT MINIMAL_CORE`, que es nuestro caso (`MINIMAL_CORE` solo se activa con
`CMAKE_SYSTEM_NAME STREQUAL "Generic"`, y Emscripten no lo es). El enlazador lo
descarta del `.wasm` final porque el shim no referencia ningún símbolo suyo.

**Consecuencia:** no hay flag de exportación que lo rescate. Hay que recompilar.

### 2. El shim es de una sola instancia, a propósito

`scripts/shim/mgba_shim.c` del port:

```c
static struct mCore* core = NULL;
/* Everything here is single-instance on purpose: one page, one emulator. */
```

Todo su estado son globales `static`: `core`, `videoBuffer`, `rgbaBuffer`,
`romData`, `sramData`, `videoWidth`, `videoHeight`.

### 3. Solo sabe avanzar frames enteros

Los 25 exports del `.wasm`:

```
mgbawasm_init            mgbawasm_load             mgbawasm_unload
mgbawasm_reset           mgbawasm_platform         mgbawasm_has_bios
mgbawasm_run_frame       mgbawasm_frame_counter    mgbawasm_framerate_micro
mgbawasm_video_ptr       mgbawasm_video_width      mgbawasm_video_height
mgbawasm_read_audio      mgbawasm_audio_available  mgbawasm_sample_rate
mgbawasm_set_keys        mgbawasm_state_size       mgbawasm_state_save
mgbawasm_state_load      mgbawasm_sram_save        mgbawasm_sram_load
mgbawasm_sram_ptr        mgbawasm_set_log_level    mgbawasm_set_idle_optimization
mgbawasm_set_allow_opposing_directions
```

No hay nada de SIO, nada de link, y ninguna forma de avanzar por ciclos.
`mgbawasm_run_frame` llama a `core->runFrame(core)`, que es `_GBACoreRunFrame`
(`src/gba/core.c:860`):

```c
static void _GBACoreRunFrame(struct mCore* core) {
	struct GBA* gba = core->board;
	uint32_t frameCounter = gba->video.frameCounter;
	uint32_t startCycle = mTimingCurrentTime(&gba->timing);
	while (gba->video.frameCounter == frameCounter && mTimingCurrentTime(&gba->timing) - startCycle < VIDEO_TOTAL_LENGTH + VIDEO_HORIZONTAL_LENGTH) {
		ARMRunLoop(core->cpu);
	}
}
```

No mira `gba->earlyExit`, así que un núcleo dormido por el lockstep seguiría
corriendo hasta el final del frame. Es el motivo por el que hace falta un runner
propio (ver «Runner por ciclos»).

### Lo que NO es una limitación

El binario ya está compilado con `-DDISABLE_THREADING -DUSE_PTHREADS=OFF`. Su
propio script lo dice: «This build is single-threaded (no SharedArrayBuffer, no
COOP/COEP requirement)». No hace falta cambiar eso ni tocar cabeceras del
servidor.

## Necesidad del fork de mGBA-wasm

Los tres límites de arriba se arreglan en el shim y en el enlazado, no en JS.
Eso obliga a:

1. Compilar nuestro propio `mgba.wasm` (Docker + emsdk + CMake).
2. **Alojarlo nosotros.** Dejamos de consumir el paquete de jsdelivr en el
   camino del Link.
3. Seguir el commit pinado de mGBA a mano.

El fork vive en `link-mgba/` dentro de esta rama. No es un `git submodule`: es
una copia controlada de las dos piezas que necesitamos —el script de build y el
shim— con el resto (SDK TypeScript, demo, manifest) fuera, porque no lo usamos.

Licencias: mGBA y `mGBA-wasm` son MPL-2.0. Los ficheros copiados conservan su
cabecera y `link-mgba/README.md` anota su origen y el commit.

## Diseño multi-instancia con un único WASM

La restricción que decide la arquitectura: `GBASIOLockstepCoordinator` guarda a
los jugadores en un `struct Table` propio
(`include/mgba/internal/gba/sio/lockstep.h`). Los cuatro `mCore` **tienen que
vivir en el mismo espacio de direcciones**.

Instanciar el módulo wasm cuatro veces no sirve: cuatro memorias lineales
aisladas, cuatro coordinadores que no se ven. Además reservaría
4 × 64 MiB = 256 MiB de golpe.

Así que: **un módulo, un `createMgbaModule()`, N `mCore` dentro.**

```c
#define MGBAWASM_MAX_INSTANCES 4

struct Instance {
	struct mCore* core;
	mColor* videoBuffer;
	uint32_t* rgbaBuffer;
	unsigned videoWidth, videoHeight;
	void* sramData;
	size_t sramSize;
	bool used;
};
static struct Instance instances[MGBAWASM_MAX_INSTANCES];
```

Cada export existente recibe un primer parámetro `int id`. El cambio es
mecánico: ~15 globales a campos, ~20 firmas con un parámetro más.

## ROM compartida

`mgbawasm_load` del port hace `malloc` + `memcpy` de la ROM por núcleo. Con
cuatro copias de Pokémon Esmeralda (16 MiB) son 64 MiB tirados.

En una sesión Link los cuatro núcleos corren **la misma ROM**, así que se carga
una vez y los cuatro `VFile` apuntan al mismo buffer:

```c
static void* sharedRom = NULL;     /* propiedad del módulo, no de la instancia */
static size_t sharedRomSize = 0;
static int sharedRomRefs = 0;
```

Es seguro: `VFileFromMemory` no toma posesión de la memoria, y el cartucho es de
solo lectura desde el punto de vista del núcleo. EEPROM y flash viven en
`savedata`, que **sí es por instancia** (`sramData`), no en el mapeo de ROM.

La ROM compartida está desde el primer prototipo. No es una optimización para
después: es lo que hace el proyecto viable en móvil.

## GBASIOLockstepCoordinator

Existe en el commit pinado, con `MAX_GBAS 4`:

```c
void GBASIOLockstepCoordinatorInit(struct GBASIOLockstepCoordinator*);
void GBASIOLockstepCoordinatorAttach(struct GBASIOLockstepCoordinator*, struct GBASIOLockstepDriver*);
void GBASIOLockstepCoordinatorDetach(struct GBASIOLockstepCoordinator*, struct GBASIOLockstepDriver*);
void GBASIOLockstepDriverCreate(struct GBASIOLockstepDriver*, struct mLockstepUser*);
```

Un coordinador estático en el shim, y por instancia un `GBASIOLockstepDriver` +
un `mLockstepUser` nuestro, enganchados con
`GBASIOSetDriver(&gba->sio, &driver->d)`.

Esto sustituye entero nuestro cable a mano: Multi-Player con sus tiempos por
número de secundarias, Normal 8/32, General Purpose con las patillas cruzadas y
UART. Las 137 líneas que añadimos a `IodineGBA/core/Serial.js` desaparecen.

`GBASIOPlayer` (en `sio/gbp.h`) **no** sirve para esto: es el Game Boy Player, el
accesorio de GameCube, no un jugador de Link.

## mLockstepUser cooperativo

`struct mLockstep` tiene el bloqueo **inyectado**, no cableado
(`include/mgba/core/lockstep.h`):

```c
void (*lock)(struct mLockstep*);
void (*unlock)(struct mLockstep*);
bool (*signal)(struct mLockstep*, unsigned mask);
bool (*wait)(struct mLockstep*, unsigned mask);
```

`mLockstepInit` (`src/core/lockstep.c`) deja `lock = NULL; unlock = NULL;`, y
`mLockstepLock()` es un no-op si son NULL. El único usuario basado en hilos,
`mLockstepThreadUser`, está detrás de `#ifndef DISABLE_THREADING`: es **una**
implementación de `mLockstepUser`, no la única.

El `Mutex mutex` del coordinador tampoco pesa: con `DISABLE_THREADING`,
`include/mgba-util/threading.h` define `typedef void* Mutex` y
`MutexInit/Lock/Unlock` como *inline* que solo hacen `UNUSED(mutex); return 0;`.

Nuestro usuario, entonces:

| Callback | Implementación |
| --- | --- |
| `sleep` | `instances[id].asleep = true` y volver |
| `wake` | `instances[id].asleep = false` |
| `requestedId` | el asiento que el lobby asignó |
| `playerIdChanged` | anotar el asiento definitivo del coordinador |

Por qué basta con un flag, y esto es el hallazgo central del informe
(`src/gba/sio/lockstep.c`):

```c
void GBASIOLockstepPlayerSleep(struct GBASIOLockstepPlayer* player) {
	if (player->asleep) {
		return;
	}
	player->asleep = true;
	player->driver->user->sleep(player->driver->user);
	player->driver->d.p->p->cpu->nextEvent = 0;
	GBAInterrupt(player->driver->d.p->p);
}
```

Con hilos, `user->sleep()` bloquea y las dos líneas siguientes corren al
despertar. Sin hilos vuelve al instante y actúan ya: `GBAInterrupt` pone
`gba->earlyExit = true` (`src/gba/gba.c:633`), y eso rompe el bucle de
`GBAProcessEvents` (`src/gba/gba.c:352`). El núcleo abandona la CPU por sí solo.

**No hay que parchear mGBA.** El lockstep no exige `mCoreThread`.

## Runner por ciclos

La condición del párrafo anterior: quien llame al núcleo tiene que mirar el
flag. `core->runFrame()` no lo hace, pero `struct mCore`
(`include/mgba/core/core.h:102-104`) ya ofrece la granularidad:

```c
void (*runFrame)(struct mCore*);
void (*runLoop)(struct mCore*);   /* un ARMRunLoop: hasta el próximo evento */
void (*step)(struct mCore*);      /* una instrucción */
```

El runner va **en C**, no en JS: desde JavaScript cruzaría la frontera wasm
miles de veces por frame.

```c
EXPORT int32_t mgbawasm_link_run(int id, int32_t targetCycles);
/* while (!inst->asleep && mTimingCurrentTime(&gba->timing) < target)
 *     inst->core->runLoop(inst->core);
 * devuelve los ciclos consumidos */
```

El coordinador de JS queda reducido a un round-robin: correr al que va más
atrasado hasta el objetivo del frame o hasta que se duerma, y repetir. La
contabilidad de ciclos de la transferencia la lleva el lockstep nativo.

## API C/JS propuesta

Sobre los 25 exports que ya existen. Todos los actuales ganan un `id`.

| Necesidad | Hoy | Falta |
| --- | --- | --- |
| `createCore()` | `mgbawasm_init` + `mgbawasm_load` | el `id` |
| `loadRom()` | `mgbawasm_load` | el `id`, ROM compartida |
| `setKeys()` | `mgbawasm_set_keys` | el `id` |
| `getFramebuffer()` | `mgbawasm_video_ptr/width/height` | el `id` |
| `readAudio()` | `mgbawasm_read_audio`, `audio_available`, `sample_rate` | el `id` |
| `saveSram()` / `loadSram()` | `mgbawasm_sram_save/load/ptr` | el `id` |
| `runCycles()` / `runUntil()` | — | `mgbawasm_link_run(id, cycles)` |
| `attachLinkNode()` | — | `mgbawasm_link_attach(id, seat)` / `_detach(id)` |
| `linkStep()` | — | no hace falta: lo hace el coordinador nativo |

Exports nuevos, en total:

```c
/* fase 2: multi-instancia, sin cable */
int      mgbawasm_instance_create(void);
void     mgbawasm_instance_destroy(int id);
int      mgbawasm_instance_count(void);
int      mgbawasm_rom_share(const void* rom, int bytes);  /* carga una vez */
void     mgbawasm_rom_release(void);
int      mgbawasm_load_shared(int id, int platform, const char* gbModel, int skipBios);

/* fase 3: cable */
int      mgbawasm_link_attach(int id, int requestedSeat);
void     mgbawasm_link_detach(int id);
int32_t  mgbawasm_link_run(int id, int32_t targetCycles);
int      mgbawasm_link_attached(void);

/* diagnóstico, para el panel que ya tenemos */
int32_t  mgbawasm_link_time(int id);
int      mgbawasm_link_asleep(int id);
int      mgbawasm_link_seat(int id);
```

Unos 5 exports nuevos imprescindibles y 3 de diagnóstico, más el `id` en los 20
existentes.

### Exports del cable, ya implementados (fase 3)

Nueve, sobre los 33 de la fase 2. Total: **42**.

| Export | Qué hace |
| --- | --- |
| `int mgbawasm_link_attach(int id, int requestedSeat)` | Engancha una consola al coordinador pidiendo asiento. Crea el `GBASIOLockstepDriver`, lo asocia al coordinador y lo instala con `GBASIOSetDriver`, que es lo que da de alta al jugador. Solo GBA. Devuelve 1 si queda enganchada |
| `void mgbawasm_link_detach(int id)` | Suelta el cable. Primero `GBASIOSetDriver(NULL)`, cuyo `deinit` saca al jugador de la tabla, y después `GBASIOLockstepCoordinatorDetach`: al revés dejaría al driver sin coordinador a quien preguntar |
| `int32_t mgbawasm_link_run(int id, int32_t targetCycles)` | Avanza una consola hasta agotar los ciclos **o hasta que el cable la duerma**. Usa `core->runLoop`, no `runFrame`. Devuelve los ciclos consumidos |
| `int mgbawasm_link_attached(void)` | Consolas dadas de alta en el coordinador |
| `int mgbawasm_link_asleep(int id)` | Si el cable la tiene dormida. Es lo que mira el planificador |
| `int mgbawasm_link_seat(int id)` | Asiento confirmado por el coordinador, o −1 |
| `int32_t mgbawasm_link_time(int id)` | Reloj emulado de la consola |
| `int mgbawasm_link_coordinator_state(int32_t* out)` | 9 enteros: consolas, transferencia activa, modo, ciclo, `multiData[0..3]`, máscara de espera |
| `int mgbawasm_link_core_state(int id, int32_t* out)` | 11 enteros: enganchada, dormida, asiento, modo SIO, SIOCNT, RCNT, `SIOMULTI0..3`, `SIOMLT_SEND` |

`mgbawasm_link_run` es el punto que hace falta explicar, porque es donde el
diseño se juega la sincronía. `mgbawasm_run_frame` no sirve para el cable:
`_GBACoreRunFrame` itera hasta el cambio de frame **sin mirar `gba->earlyExit`**,
así que una consola dormida por el lockstep seguiría corriendo y se saldría de
sincronía. `core->runLoop` es un `ARMRunLoop` que vuelve en el siguiente evento
de timing, y entre vuelta y vuelta se consulta la bandera de dormida. El bucle
va en C y no en JS a propósito: desde JavaScript cruzaría la frontera wasm miles
de veces por frame.

El `mLockstepUser` cooperativo son cuatro funciones de tres líneas. `sleep` no
bloquea: levanta una bandera y vuelve. Funciona porque `GBASIOLockstepPlayerSleep`,
justo después de llamarla, pone `cpu->nextEvent` a 0 y llama a `GBAInterrupt`,
que activa `gba->earlyExit` y saca al núcleo del bucle de CPU. `requestedId`
devuelve el asiento que pide el lobby y `playerIdChanged` anota el que el
coordinador confirma.

Y el planificador de JS no compara relojes emulados sino los ciclos que devuelve
`link_run`: `mTiming` es un `int32` que el propio mGBA reajusta, así que comparar
valores absolutos entre dos núcleos no es de fiar.

### El aviso al soltar el último asiento

```
[mgba:GBA Serial I/O] Reconfiguring player IDs with no players attached somehow?
```

Sale una vez por sesión de cable y **no es de nuestro orden de detach**. Es
inherente a la API de mGBA:

```c
void _removePlayer(struct GBASIOLockstepCoordinator* coordinator, struct GBASIOLockstepPlayer* player) {
	...
	TableRemove(&coordinator->players, player->driver->lockstepId);
	_reconfigPlayers(coordinator);
	...
}

void _reconfigPlayers(struct GBASIOLockstepCoordinator* coordinator) {
	size_t players = TableSize(&coordinator->players);
	...
	if (players == 0) {
		mLOG(GBA_SIO, WARN, "Reconfiguring player IDs with no players attached somehow?");
	}
```

`_removePlayer` reconfigura **después** de quitar al jugador, así que al soltar
el último la tabla está vacía por definición y el aviso salta. Cualquier
frontend que desenganche todas sus consolas lo produce; evitarlo exigiría no
soltar nunca el último asiento, que no es una opción.

No se silencia. La prueba exige que sea **exactamente ese**: cuenta los avisos
conocidos aparte y falla si aparece cualquier otro. Así el ruido esperado no
tapa uno nuevo.

## Partes reutilizables de LocalLinkSession.js

De 1 349 líneas, sobreviven unas 620.

| Zona | Líneas | Destino |
| --- | --- | --- |
| Params, `handleLocalKey`, `controller`, `BroadcastChannel`, `sendLocal` | 1-105 | **Se queda** |
| `makeHiddenCore` | 106-118 | Se sustituye (3 líneas) |
| Anillo de input, `publishReady`, `maybeHostStart`, `acceptRemoteReady`, `start` | 208-280 | **Se queda** |
| `installLocalCable` — el cable a mano | 281-737 | **Se borra** |
| `childSeats`, `listeningChildren`, `carryTransfer` | 738-879 | **Se borra** |
| `applyMask`, `stepCore` | 880-951 | Se sustituyen, 2-3 líneas cada uno |
| `publishLocalInput`, `acceptRemoteInput`, `frameReady` | 894-933 | **Se queda** |
| `runFrame` — reparto de reloj | 952-1058 | Round-robin de ~20 líneas |
| `tick` | 1059-1078 | **Se queda** |
| Panel de depuración | 1079-1206 | Se queda, recableado |
| `destroy`, `configureSession`, `disconnectSession` | 1207-1349 | **Se queda** |

Unas 600 líneas se borran, ~130 se sustituyen.

Intacto, y es requisito de esta rama: `link-lab/rooms.js`, `link-lab/embed.js`,
`link-lab/embed-games.js`, `ml3d-lobby-overlay.js`, WebRTC, salas, asientos, el
protocolo `gba:link:configure`, el reparto de ROM y el forwarding de input.
Ninguno de esos ficheros referencia el emulador.

## Estrategia para 2, 3 y 4 consolas

Nativa, sin código nuestro. `MAX_GBAS 4` en `include/mgba/internal/gba/sio.h`.

El coordinador reparte los IDs por preferencia (`src/gba/sio/lockstep.c`):
recoge el `requestedId` de cada jugador, los ordena y confirma por
`playerIdChanged`. Enchufamos el asiento del lobby en `requestedId`.

El asiento 0 es el dueño del reloj: `GBASIOLockstepCoordinatorWaitOnPlayers`
afirma `player->playerId == 0`. Coincide con nuestro host actual, así que el
reparto de asientos del lobby no cambia.

Con tres o cuatro, el host sigue siendo el único que habla con todos y reenvía
las teclas de cada invitado: eso es capa de lobby y no se toca.

## Memoria estimada

Del build oficial, que mantenemos: `INITIAL_MEMORY=67108864` (64 MiB),
`MAXIMUM_MEMORY=536870912` (512 MiB), `ALLOW_MEMORY_GROWTH=1`,
`STACK_SIZE=1048576` (1 MiB).

Por instancia, sumando lo que asigna el shim y lo que ocupa un GBA:

| Concepto | Tamaño |
| --- | --- |
| `videoBuffer` + `rgbaBuffer` (256 × 224 × 4, ×2) | 448 KiB |
| Buffer de audio (`setAudioBufferSize(0x4000)`) | ~64 KiB |
| EWRAM 256 + IWRAM 32 + VRAM 96 + paleta/OAM 2 | 386 KiB |
| `savedata` (flash 1 Mbit, peor caso) | 128 KiB |
| **Total por instancia, sin ROM** | **~1 MiB** |

| Escenario | Memoria |
| --- | --- |
| 4 núcleos, ROM de 16 MiB compartida | ~20 MiB — cabe en los 64 MiB iniciales |
| 4 núcleos, 4 copias de la ROM de 16 MiB | ~68 MiB — pasa del inicial y crece |
| 4 instancias wasm separadas | 256 MiB reservados, y no funciona |

## Plan de pruebas

Por fases, y ninguna avanza sin la anterior. Las fases 1 y 2 se miden en CI con
`link-mgba/scripts/smoke.cjs`, sin navegador; las páginas de `link-mgba/prototype/`
son la comprobación a ojo encima de eso.

**Fase 1 — reproducir el build oficial.** Compilar con el script del port sin
tocar nada y comparar contra el `.wasm` publicado.
Criterio: el prototipo aislado arranca un juego, con imagen y sonido, igual que
`mgba-compat.js`. No se exige un binario byte a byte: una versión distinta de
emsdk cambia el binario sin cambiar el comportamiento.

**Fase 2 — shim multi-instancia, sin cable.** ROM compartida desde el principio.
Criterio: dos `mCore` en el mismo módulo, la misma ROM cargada una vez, ambos
avanzando frames de forma independiente, dos canvas con imagen distinta al
pulsar botones distintos. Medir memoria con 1 y con 2 núcleos.

**Fase 3 — coordinador nativo.** Solo tras la fase 2. Primero con asserts
activados (ver riesgos), dos consolas, `linkSelfTest` local.
Criterio: el barrido que ya tenemos para IodineGBA, mismo procedimiento
(30-40 s pulsando el mismo patrón en todas las consolas) y mismos números como
referencia:

| Juego | Transferencias (IodineGBA, 2 jugadores) | COMMERROR |
| --- | --- | --- |
| Mario Kart Super Circuit | 6 738 | 0 |
| Super Mario Bros. 3 (SMA4) | 3 566 | 0 |
| DragonBall Z Taiketsu | 2 741 | 0 |

**Fase 4 — cuatro consolas**, con Mario Kart y SMA4, que son los dos que ya
tienen número a cuatro (8 183 y 4 491 transferencias).

**Fase 5 — integración con el lobby.** Recablear `LocalLinkSession.js` según la
tabla de arriba. El lobby no se toca.

**Fase 6 — retirar IodineGBA.** Solo cuando la fase 5 esté validada con dos
dispositivos reales.

## Riesgos conocidos

**Desincronía silenciosa.** El coordinador vigila sus invariantes con
`mASSERT_DEBUG` y `mASSERT_LOG` —`_verifyAwake` exige que no duerman todos los
jugadores a la vez—, y el build oficial pasa `-DNDEBUG`, que los desactiva. Un
scheduler mal escrito no dará un error claro sino desincronía callada.
Mitigación: la primera compilación de la fase 3, **con** asserts.

**Desajuste de defines entre el shim y `libmgba.a`.** `struct mCore` cambia de
forma según `ENABLE_VFS`, `ENABLE_DIRECTORIES` y `MINIMAL_CORE`; si no coinciden,
cada puntero de función pasado ese campo se lee del offset equivocado y falla en
el primer `core->init()`, lejos de la causa. El script oficial ya lo resuelve
leyendo los defines de `CMakeFiles/mgba.dir/flags.make`; **no restatearlos a
mano** al portar el script.

**Un hilo para cuatro núcleos.** Cuatro GBA emulados en el hilo principal a 60
fps es el mismo presupuesto que ya gasta IodineGBA con cuatro núcleos, pero mGBA
es más preciso y por tanto más caro. Sin medir no se sabe si un móvil aguanta
cuatro. La fase 4 es también la prueba de rendimiento.

**Audio de las consolas ocultas.** Tres de los cuatro núcleos no deben sonar.
`mgbawasm_read_audio` se llama solo para la instancia visible; hay que
comprobar que no drenar el buffer de las otras no acaba atascando el núcleo.

**Cartuchos con ROM escribible.** La ROM compartida da por hecho que el mapeo
del cartucho es de solo lectura. Lo es para todo lo comercial, pero mGBA mapea
algunos cartuchos no licenciados y los de Matrix Memory de forma escribible; con
el buffer compartido, la escritura de una consola llegaría a las otras. La
biblioteca es comercial, así que no debería pasar, pero si un juego se comporta
raro solo en Link es el primer sitio donde mirar, y la salida es volver a copias
privadas para ese cartucho.

**Dependencia de un commit de master.** `c034660` es master, no una release. Un
`git pull` a ciegas puede cambiar la API del coordinador, que es código
relativamente nuevo. El pin es obligatorio.

**Hosting propio del `.wasm`.** Pasamos de un CDN público a un artefacto
nuestro: hay que versionarlo con cache-busting como el resto y decidir si la
partida normal sigue en jsdelivr o migra al nuestro. Mientras el prototipo esté
aislado, `mgba-compat.js` no se toca.

**Fase 1 sin binario idéntico.** Una versión distinta de emsdk produce un
`.wasm` distinto. El criterio de la fase 1 es de comportamiento, no de hash; si
se quiere reproducibilidad exacta hay que pinar también la imagen de emsdk.

## Repetir las comprobaciones

```bash
# el .wasm publicado y la ausencia del lockstep
curl -sL https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.wasm -o mgba.wasm
grep -ao "All players acked" mgba.wasm | wc -l                 # 0
grep -ao "Could not initialize SIO driver" mgba.wasm | wc -l   # 1

# los 25 exports
curl -sL https://cdn.jsdelivr.net/npm/@wasm-gaming/mgba-wasm@0.1.1/dist/mgba/mgba.js \
  | grep -aoE "_mgbawasm_[a-z0-9_]+" | sort -u

# el commit pinado y las flags del build
curl -sL https://raw.githubusercontent.com/wasm-gaming/mGBA-wasm/main/scripts/build-mgba.sh

# el lockstep, en el commit exacto
curl -sL https://raw.githubusercontent.com/mgba-emu/mgba/c034660f007c543233f1cadeb0ca13c71afd8f41/src/gba/sio/lockstep.c
curl -sL https://raw.githubusercontent.com/mgba-emu/mgba/c034660f007c543233f1cadeb0ca13c71afd8f41/include/mgba/core/lockstep.h
```
