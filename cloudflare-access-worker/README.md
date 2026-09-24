# ML3D Dev Access Worker

Backend para convertir `dev=1` en acceso de desarrollo aprobado por dispositivo/navegador.

## Preparación en Cloudflare

1. Crear una base D1 llamada `ml3d-dev-access`.
2. Copiar `wrangler.toml.example` a `wrangler.toml` y sustituir `REPLACE_WITH_D1_DATABASE_ID` por el ID real de D1.
3. Ejecutar `npm install` dentro de esta carpeta.
4. Crear un secreto de administración fuerte con `npx wrangler secret put ADMIN_TOKEN`.
5. Crear en GitHub un token **fine-grained** limitado al repositorio `makinglayers3d-a11y/gba-nfc`, con permiso **Contents: Read and write**, y guardarlo solo en Cloudflare con `npx wrangler secret put GITHUB_TOKEN`.
6. Crear las tablas con `npx wrangler d1 execute ml3d-dev-access --remote --file=schema.sql`.
7. Desplegar con `npx wrangler deploy`.
8. Copiar la URL `https://...workers.dev` resultante a `dev-access-config.json` y cambiar `enabled` a `true`.
9. En ML3Demu-tools > Herramientas emulador > Conceder acceso introducir la misma URL del Worker y el valor de `ADMIN_TOKEN`.

## Seguridad

El navegador genera una clave ECDSA P-256 propia. La clave privada permanece en ese navegador y el backend almacena solo la clave pública. Cada acceso aprobado requiere responder correctamente a un desafío firmado, por lo que copiar solo el identificador del dispositivo no concede acceso.

`ADMIN_TOKEN` nunca debe guardarse en este repositorio ni dentro del APK. Se configura como secreto de Cloudflare y se introduce manualmente en la app de gestión.

Este sistema bloquea la interfaz del emulador para URLs `dev=1`. Los ROM alojados públicamente siguen siendo recursos públicos; proteger también los archivos ROM exigiría servirlos mediante un backend autenticado o URLs temporales.


## Gestión de juegos

Los endpoints de administración de juegos usan `GITHUB_TOKEN` solo en el Worker. El APK nunca recibe ni almacena ese token. Las altas y bajas actualizan `games/`, `game-management.json` y `games-catalog.json`; las bajas eliminan también previews asociados y la carátula solo cuando el administrador confirma esa segunda eliminación.
