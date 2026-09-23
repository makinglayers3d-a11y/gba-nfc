# ML3D Link dentro del emulador

Rama de pruebas `test/lobby-en-emulador-2026-09-23`.

Hasta ahora el lobby era la página y el emulador vivía dentro de él
(`linkEmulatorShell`). Aquí se invierte: **el emulador es la página** y el lobby
aparece en su pantalla, controlado por los botones de la consola.

## Piezas

| Archivo | Papel |
| --- | --- |
| `ml3d-lobby-overlay.js` / `.css` | Crea el iframe del lobby sobre `.screen-frame`, reenvía los botones y vuelve al juego. |
| `link-lab/embed.js` / `embed.css` | Lado lobby con `?embed=1`: menú simplificado, cursor de cruceta, botón VOLVER. |
| `index.html` | Entrada `ML3D Link · Lobby` en el menú ☰ y `window.ML3D_LINK_TRANSPORT = "dual"`. |
| `app.js` | `pressKey`/`releaseKey` ceden los botones al lobby; `ML3DLinkRuntime.restartForLink()`. |
| `user_scripts/LocalLinkSession.js` | Acepta `gba:link:configure` en caliente, sin parámetros en la URL. |

El iframe del lobby se crea una sola vez y al volver al juego **se oculta, no se
destruye**: la sala WebRTC y el chat siguen vivos durante la partida.

## Botón de entrada

Está en el menú ☰ (`#open-lobby-button`), no sobre la pantalla ni sobre los
controles. En la carcasa SP los botones son zonas invisibles sobre la foto, así
que cualquier botón nuevo en pantalla estorbaría sí o sí.

## Mando

| Botón | En el menú | En la sala |
| --- | --- | --- |
| Cruceta | mueve el cursor; ←/→ cambian desplegables | anda |
| A | elige | interactúa (descargar el juego que alguien comparte) |
| B | atrás; en el menú raíz vuelve al juego | cierra lo abierto, si no vuelve al juego |
| L | — | personaje |
| R | — | chat |
| SELECT | atrás | menú de sala |
| START | elige | — |

El botón **VOLVER ✕** está en la esquina superior derecha del lobby. La leyenda
de botones va abajo a la izquierda, sin fondo, para no tapar la sala.

Escribir (nombre de sala, código, chat) sigue siendo táctil: se toca el campo y
sale el teclado del móvil. Un teclado en pantalla manejado con la cruceta queda
pendiente.

## Menú del lobby

Cuatro entradas en vez de cuatro tarjetas apiladas: `CREAR SALA`,
`ENTRAR POR CÓDIGO`, `BUSCAR CERCA` y `AJUSTES` (servidor de salas y registro
técnico). `UNIRSE A LA SALA` aparece sola al elegir una sala. Diagnóstico,
métricas y los botones «ABRIR EMULADOR LINK» desaparecen: ahora sobran.

Nada de esto duplica lógica: `embed.js` mueve los controles originales de
`rooms.html` dentro de sus paneles, así que `rooms.js` sigue mandando.

## Menú de sala (SELECT)

`INICIAR CONEXIÓN` y `COMPARTIR JUEGO` están en el nivel principal del menú, no
dentro de un desplegable. El resto (juego, jugadores, sala, conexión) sigue
plegado debajo. Al iniciar, el menú se cierra y arranca la cuenta atrás que ya
existía.

## Juego de la sala

El desplegable de la esquina inferior derecha elige el juego entre lo que hay:
el juego cargado en el emulador, la biblioteca (`games-catalog.json`) y lo que
alguien comparta en la sala. Escribe en el mismo ajuste de sala que ya existía
(`#hostGameInput` + `APLICAR JUEGO`), así que se propaga por la API y por los
paquetes `lobby:room`. Los invitados solo ven, en esa esquina, el juego que ha
elegido el host.

`INICIAR CONEXIÓN` no arranca y avisa cuando:

- no hay juego elegido;
- falta el estado de algún jugador de la sala;
- alguien, tú incluido, no tiene ese juego **cargado** en su emulador.

La comprobación mira el juego cargado, no la biblioteca: el cable Link arranca
desde la ROM que cada emulador tiene puesta.

## Compartir juego

`link-lab/embed-games.js` habla por los mismos `RTCDataChannel` del lobby con
paquetes `ml3d:game:*`, como hace `avatar-final.js` con el avatar, así que
`rooms.js` no se toca.

1. `COMPARTIR JUEGO` en el menú SELECT abre el selector de archivos del
   dispositivo (`.gba`, `.gb`, `.gbc`).
2. Quien comparte luce un bocadillo holográfico **COMPARTIENDO JUEGO** sobre su
   avatar, con el nombre del juego.
3. Cuando otro avatar se acerca (14% del ancho, 13% del alto de la sala), junto
   al bocadillo aparece el botón **A** animado pulsándose.
4. Al pulsar A dentro de ese rango sale el diálogo del juego: `DESCARGAR JUEGO`
   manda la ROM por el canal en trozos de 12 KB, con porcentaje.
5. Al terminar, el archivo se guarda en el dispositivo y el diálogo pregunta
   `¿CARGAR AHORA?`. Si sí, el emulador lo arranca como ROM local y el lobby se
   cierra.

## Modos del cable Link

El cable emulado (`IodineGBA/core/Serial.js` + el coordinador dual de
`user_scripts/LocalLinkSession.js`) cubre ahora los modos que usan los juegos
cuando **cada jugador tiene su cartucho**:

| Modo | Estado |
| --- | --- |
| Multi-Player (SIOCNT modo 2) | Completo para 2, 3 y 4 consolas: IDs, baudios, tiempos por número de secundarias, COMMERROR, SIOMULTI0-3, bits SI/SD y pines RCNT. Es el que usan casi todos los juegos. |
| Normal 8 y 32 bits (modos 0 y 1) | El maestro clocka y el esclavo desplaza su registro tenga o no transferencia pedida, como el hardware. Sin pareja en ese modo, el maestro recibe la línea en reposo (todo unos) en vez de colgarse. |
| General Purpose (RCNT modo 2) | SC y SD son bus común con pull-up; el SI de cada consola cuelga del SO de la otra; IRQ por flanco de bajada de SI. Lo usan los juegos que sondean las patillas para detectar al compañero. |
| UART (SIOCNT modo 3) | Los bytes escritos en SIODATA8 llegan a la cola del otro lado, con el bit de "cola vacía" en SIOCNT. Apenas lo usa software comercial. |
| JOY Bus (RCNT modo 3) | Solo registros. Es el enlace con GameCube, no cartucho contra cartucho. |
| Multiboot (un solo cartucho) | Fuera de alcance por decisión propia. |

## Salas de 2 a 4 jugadores

La sala se crea eligiendo jugadores (2, 3 o 4) y el host puede cambiarlo después
desde `GESTIÓN DE SALA`. Los invitados ocupan los asientos 1, 2 y 3 por orden de
llegada; el host siempre es el 0.

Cada navegador emula su consola **más una copia oculta por compañero**: cuatro
núcleos GBA deterministas en una sala llena. El coordinador
(`user_scripts/LocalLinkSession.js`) reparte el reloj entre todos, nunca deja que
una secundaria adelante al padre, y solo completa una transferencia cuando todas
han llegado al instante del START. El paquete `gba:link:configure` lleva cuántos
son, así que todos montan el mismo número de asientos.

Con tres o cuatro, el host reenvía además las teclas de cada invitado a los
demás: es el único que habla con todos.

`INICIAR CONEXIÓN` exige exactamente los jugadores de la sala, con sus asientos
seguidos, antes de arrancar la cuenta atrás.

General Purpose y UART son enlaces de dos consolas; con tres o cuatro quedan
inertes, como el cable real en cadena.

## Partida Link

1. El lobby avisa por `BroadcastChannel("ml3d-gba-link-v1")` con
   `gba:link:configure` (host al iniciar, invitado al recibir su asiento),
   incluyendo el juego elegido en la sala.
2. `LocalLinkSession` se configura en caliente y llama a
   `ML3DLinkRuntime.prepareForLink(juego)`: si ese juego no es el que está
   puesto, lo busca en la biblioteca y lo abre; si ya lo está, lo reinicia.
   En ambos casos **sin partida guardada**, que es como deben arrancar los
   cuatro núcleos para que el lockstep sea determinista.
3. `ml3d-rom-started` encadena con `bootLocalDual()` y el emulador publica
   `gba:lockstep:ready`.
4. `openLinkEmulator()` en modo embebido ya no abre ningún iframe: avisa al
   emulador para que cierre el lobby y devuelva el mando al juego.

El juego se congela mientras el lobby ocupa la pantalla, salvo si hay sala
configurada: ahí el tiempo emulado lo lleva el coordinador del Link.

## Probarlo en este PC

Doble clic en `probar-lobby-local.cmd` (o `probar-lobby-local.cmd dos` para dos
jugadores: abre además una ventana de incógnito). Sirve el repo en
`http://localhost:8765/` y abre el navegador. Equivale a:

```
powershell -ExecutionPolicy Bypass -File dev-server.ps1
```

Hace falta servidor: con `file://` el lobby no arranca, porque `rooms.js` se
pide por `fetch`. `localhost` es contexto seguro, así que geolocalización y
WebRTC van como en el sitio publicado; por IP de red local (`192.168.…`) no.

Con teclado: flechas = cruceta, `X` = A, `Z` = B, `A` = L, `S` = R,
`Enter` = START, `Shift` = SELECT.

### Salas desde localhost

El worker de salas solo admite el origen del sitio publicado
(`ALLOWED_ORIGIN`), así que desde `localhost` el navegador cortaba las llamadas
por CORS y salía **Failed to fetch** al crear sala. `dev-server.ps1` reenvía
`/api/...` al worker: petición servidor a servidor, sin `Origin`, y el lobby la
ve como mismo origen. `rooms.js` apunta ahí solo en `localhost`, así que no hay
nada que configurar; en el sitio publicado sigue yendo directo al worker.

Si en `AJUSTES` el campo no pone `http://localhost:8765/api`, corrígelo y pulsa
`GUARDAR API`: un valor guardado antes en este navegador manda sobre el
predeterminado.

Para una sala de verdad hacen falta dos contextos aislados: ventana normal más
ventana de incógnito, o dos dispositivos. Dos pestañas de la misma ventana no
valen: comparten el `BroadcastChannel` del cable Link y se cruzan las partidas.

## Barrido por juegos de la biblioteca

Cada juego se arranca con el selftest de doble núcleo (dos o cuatro consolas
locales), se le dan 30-40 s pulsando el mismo patrón de botones en todas las
consolas (START, A, cruceta) y se mide qué hace el cable. Pulsar a ciegas no
entra en menús de Link que exigen navegación concreta, así que un cero en
transferencias no significa que el juego falle: significa que la prueba
automática no llegó a su menú.

**Dos jugadores**

| Juego | Modos SIO | Transferencias | COMMERROR |
| --- | --- | --- | --- |
| Mario Kart Super Circuit | Normal + MULTI | 10.174 | 0 |
| Super Mario Bros. 3 (SMA4) | Normal + MULTI | 6.605 | 0 |
| DragonBall Z Taiketsu | MULTI | 2.739 | 0 |
| Zelda ALTTP & Four Swords | MULTI | 640 | 0 |
| Sonic Advance 2 | MULTI | 1 | 0 |
| DBZ Supersonic Warriors | MULTI | 0 | 0 |
| Pokémon Esmeralda | Normal 32 + MULTI + RCNT general | 0 | 0 |
| Pokémon Rojo Fuego | MULTI | 0 | 0 |
| Pokémon Rubí | Normal + RCNT general | 0 | 0 |
| Donkey Kong King of Swing | Normal | 0 | 0 |

Ninguno se atascó ni dio error de comunicación. Top Gear Rally y V-Rally 3
quedaron sin correr.

**Cuatro jugadores**

| Juego | Transferencias | COMMERROR |
| --- | --- | --- |
| Mario Kart Super Circuit | 8.183 | 0 |
| Super Mario Bros. 3 (SMA4) | 4.491 | 0 |

Los Pokémon tocan el modo General Purpose (RCNT 2) que antes no cruzaba patillas
entre consolas; ahora sí, pero su menú de intercambio solo se alcanza jugando.

El barrido a cuatro destapó dos fallos que ya están corregidos: el cable solo se
enganchaba a los asientos 0 y 1, y el padre exigía que todas las secundarias
estuvieran en MULTI en el mismo instante. Con las dos correcciones, Mario Kart a
dos jugadores repitió 6.738 transferencias sin errores, así que el camino de dos
sigue igual de sano.

## Probado

Con un servidor estático local y Chrome headless:

- El lobby aparece dentro de `.screen-frame` y sus controles propios no se ven.
- Cruceta, A y B navegan el menú y los paneles; B vuelve al emulador.
- Con la sala visible, la cruceta manda flechas a `rooms.js`, L y R abren
  personaje y chat, y A abre el menú de sala.
- `gba:link:configure` por BroadcastChannel reinicia la ROM y arranca el
  lockstep: `gba:lockstep:ready` sale con el `roomId` correcto.
- El juego corre, se congela con el lobby abierto y sigue al volver.
- Menú SELECT con `INICIAR CONEXIÓN` y `COMPARTIR JUEGO` arriba; A ya no abre el
  menú.
- El desplegable de juego se llena con la biblioteca (56 juegos) y el cargado.
- Los tres avisos que bloquean `INICIAR CONEXIÓN`, y que con todo en orden la
  pulsación sí llega al lobby.
- Bocadillo holográfico, botón A al acercarse y desaparición al alejarse.
- Transferencia real entre dos lobbies conectados por WebRTC: 2 MB en 1,1 s,
  bytes idénticos en destino.
- Configurar la sala con otro juego cambia la ROM del emulador sola y el
  lockstep arranca con la nueva (Pokémon → Mario Kart, hash nuevo).
- Los modos del cable, sobre los dos núcleos del selftest: SI cruzado y SC
  compartido en General Purpose con su IRQ de bajada; UART en los dos sentidos;
  Normal 8 (0x37 ↔ 0x42) y Normal 32 (0xDEADBEEF ↔ 0x56781234); y Normal sin
  pareja devolviendo 0xFF sin dejar BUSY colgado.

## Pendiente

- Prueba real con dos dispositivos y el worker de salas: aquí no hay servidor
  de salas ni segundo par.
- Aviso dentro del juego cuando el host arranca la sesión con el lobby cerrado.
- Teclado en pantalla manejado con los botones.
- En este checkout Windows (`core.autocrlf=true`) el parche de
  `rooms-runtime-loader.js` no casa por los CRLF y avisa en consola; en el sitio
  publicado (LF) sí casa. No es de esta integración.
