# ML3D GBA Link — port final aislado

Fuente funcional validada: `makinglayers3d-a11y/gba-nfc-gb@b02b84ca42b4e45bfb90c2dc69b35510a0349a6c`.

Esta rama contiene el lado **emulador** del Cable Link final que pasó el selftest de Super Mario Advance 4 en las dos variantes del coordinador dual. Está preparada para integrarse junto al lobby sin reconstruir el sistema Link.

## Archivos runtime que forman el sistema final

- `IodineGBA/core/Serial.js` — implementación de MULTI/Normal Link, estado de pines, player ID, temporización y transferencias externas.
- `IodineGBA/core/RunLoop.js` — reloj virtual compartido y eventos seriales necesarios para dos núcleos deterministas.
- `IodineGBA/core/Memory.js` — escrituras SIOCNT atómicas y corrección crítica de lectura 32-bit de `SIOMULTI0/1` en `0x04000120`.
- `user_scripts/LocalLinkSession.js` — coordinador dual-core local y lockstep de entradas.
- `user_scripts/LinkCableBridge.js` — compatibilidad del adaptador Link; en `linkTransport=dual` se desactiva el transporte serial remoto antiguo.
- `app.js` — entrega controles al lockstep, conserva una copia de la ROM para el segundo núcleo, desactiva el timer normal durante Link y evita cargar saves distintos entre los dos núcleos.
- `index.html` — carga el runtime Link y fuerza renovación de caché para RunLoop/Memory/Serial/app.

## Arquitectura que debe conservar el lobby

El modo final es **dual-core determinista**. No se mandan palabras SIO por WebRTC.

Cada navegador ejecuta dos núcleos GBA locales. El lobby/WebRTC solamente retransmite:
- `gba:lockstep:ready`
- `gba:lockstep:start`
- `gba:lockstep:input`

Y entrega al iframe del emulador:
- `gba:lockstep:remote-ready`
- `gba:lockstep:start`
- `gba:lockstep:remote-input`

El iframe debe abrirse con:
- `linkRoom=<roomId>`
- `linkPlayer=0|1`
- `linkRole=host|guest`
- `linkTransport=dual`

El `link-lab/rooms.js` del commit fuente ya implementa exactamente este contrato y añade `linkTransport=dual` al abrir el emulador. Al portar el lobby, usar el `link-lab/` de ese mismo commit para no mezclar versiones.

## No portar

No son parte del runtime final:
- `.github/workflows/link-selftest.yml`
- `link-lab/ci-link-selftest.mjs`
- `link-lab/ci-rom-disasm.py`
- modificaciones HLE MultiBoot de `IodineGBA/core/CPU/SWI.js`
- artefactos de CI, dumps y pruebas de Single-Pak/MultiBoot
- ramas/commits intermedios de diagnóstico

La causa final del ERROR de Mario era doble:
1. el flujo Single-Pak artificial interfería con el segundo cartucho real y fue eliminado;
2. `Memory.readIO32()` usaba `0x04000110` en vez de `0x04000120`, por lo que P2 no podía leer `SIOMULTI0/1` en 32 bits.

## Alcance validado

El runtime final está validado para dos jugadores GBA (P1/P2). El coordinador actual usa dos asientos locales y no debe anunciarse como soporte 3/4 jugadores sin una ampliación y nuevas pruebas.

## Estado esperado al validar después del merge

Con Super Mario Advance 4 / Mario Bros:
- ambos núcleos permanecen en SIO MULTI;
- no aparece COMMERROR;
- P2 consume `SIOMULTI0`;
- el intercambio deja atrás el bucle F00F/FDFD;
- el flujo llega al menú Mario Bros. Battle con P1/P2;
- el coordinador queda `wedged=false` y sin stalls permanentes.

Esta rama está deliberadamente separada de `main` para poder portar primero el lobby y después hacer un único merge controlado.
