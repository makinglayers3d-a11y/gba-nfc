# Preview desplegable — test/final-link-lobby-2026-09-21

Copia publicable de la rama `test/final-link-lobby-2026-09-21`
(commit fuente `3cbce7feb26815af3a4738b604ae373d7ac21b47`) para poder
probar el lobby Link desde cualquier dispositivo sin tocar el sitio
publicado desde `main`.

Entrada de prueba:
https://makinglayers3d-a11y.github.io/gba-nfc/preview/final-link-lobby/link-lab/rooms.html

## Diferencias respecto a la rama

Sólo dos, y ninguna toca el runtime Link:

- `games/` no se copia (578 MB). Las ROMs se sirven desde la copia ya
  publicada en `/gba-nfc/games/`.
- `app.js` y `GB/simple.js` apuntan a `/gba-nfc/games/...` en vez de a
  `games/...` por el motivo anterior.

Todo lo demás (`IodineGBA/core/Serial.js`, `RunLoop.js`, `Memory.js`,
`user_scripts/LocalLinkSession.js`, `user_scripts/LinkCableBridge.js`,
`link-lab/`, `index.html`) es idéntico a la rama.

Esto NO es el merge del Link a `main`: los archivos del sitio en la raíz
del repo siguen intactos. Para retirar el preview basta con borrar esta
carpeta en un commit.
