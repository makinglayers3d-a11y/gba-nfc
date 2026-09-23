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
| A | elige | abre el menú de sala |
| B | atrás; en el menú raíz vuelve al juego | cierra lo abierto, si no vuelve al juego |
| L | — | personaje |
| R | — | chat |
| SELECT | atrás | menú de sala |
| START | elige | menú de sala |

El botón **VOLVER ✕** está en la esquina superior derecha del lobby.

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

## Partida Link

1. El lobby avisa por `BroadcastChannel("ml3d-gba-link-v1")` con
   `gba:link:configure` (host al iniciar, invitado al recibir su asiento).
2. `LocalLinkSession` se configura en caliente y llama a
   `ML3DLinkRuntime.restartForLink()`: la ROM actual se reinicia **sin partida
   guardada**, que es como deben arrancar los cuatro núcleos para que el
   lockstep sea determinista.
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

Para una sala de verdad hacen falta dos contextos aislados: ventana normal más
ventana de incógnito, o dos dispositivos. Dos pestañas de la misma ventana no
valen: comparten el `BroadcastChannel` del cable Link y se cruzan las partidas.

## Probado

Con un servidor estático local y Chrome headless:

- El lobby aparece dentro de `.screen-frame` y sus controles propios no se ven.
- Cruceta, A y B navegan el menú y los paneles; B vuelve al emulador.
- Con la sala visible, la cruceta manda flechas a `rooms.js`, L y R abren
  personaje y chat, y A abre el menú de sala.
- `gba:link:configure` por BroadcastChannel reinicia la ROM y arranca el
  lockstep: `gba:lockstep:ready` sale con el `roomId` correcto.
- El juego corre, se congela con el lobby abierto y sigue al volver.

## Pendiente

- Prueba real con dos dispositivos y el worker de salas: aquí no hay servidor
  de salas ni segundo par.
- Aviso dentro del juego cuando el host arranca la sesión con el lobby cerrado.
- Teclado en pantalla manejado con los botones.
- En este checkout Windows (`core.autocrlf=true`) el parche de
  `rooms-runtime-loader.js` no casa por los CRLF y avisa en consola; en el sitio
  publicado (LF) sí casa. No es de esta integración.
