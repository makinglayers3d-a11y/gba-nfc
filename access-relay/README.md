# ML3D Access Relay

Relay HTTPS mínimo para que ML3Demuler y ML3D NFC Writer puedan alcanzar la API de acceso cuando `*.workers.dev` no sea accesible desde una red concreta.

## Seguridad

- Solo acepta rutas bajo `/v1/*`.
- El destino está fijado al Worker ML3D; no es un proxy abierto.
- Solo admite `GET`, `POST` y `OPTIONS`.
- Conserva `Authorization` para las llamadas administrativas de ML3D NFC Writer.
- No registra ni almacena tokens, cuerpos ni respuestas.
- Respuestas con `Cache-Control: no-store`.
- CORS permitido por defecto solo para `https://makinglayers3d-a11y.github.io`.

## Despliegue en Vercel

1. Importar el repositorio `makinglayers3d-a11y/gba-nfc`.
2. En **Root Directory**, seleccionar `access-relay`.
3. No hace falta añadir secretos para la configuración actual.
4. Desplegar.
5. Probar `https://<dominio-vercel>/v1/health`; debe devolver el JSON del Worker con `ok: true`.

Variables opcionales:

- `UPSTREAM_BASE`: cambia el Worker de destino. Por defecto: `https://ml3d-dev-access.makinglayers3d.workers.dev`.
- `ALLOWED_ORIGIN`: cambia el origen web permitido. Por defecto: `https://makinglayers3d-a11y.github.io`.

## Activación

Cuando el relay esté validado desde una red donde `workers.dev` falle, usar su URL base como `apiBase` en `dev-access-config.json` y en ML3D NFC Writer.
