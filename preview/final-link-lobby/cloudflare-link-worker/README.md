# ML3D Link Worker

Backend experimental e independiente para descubrir salas cercanas y automatizar la señalización WebRTC de ML3D Link.

No comparte tablas, Worker ni credenciales con el sistema de acceso promocional de ML3Demuler.

## Componentes

- Worker: `src/index.js`
- D1: `ml3d-link-lab`
- Esquema: `schema.sql`
- Binding D1 esperado: `DB`
- Origen web permitido: `https://makinglayers3d-a11y.github.io`

## Privacidad de ubicación

El navegador envía la ubicación al Worker por HTTPS. El Worker redondea la posición del host a 3 decimales antes de guardarla (aprox. 100 m en latitud). Las búsquedas reciben solo una distancia aproximada; la API no devuelve las coordenadas de las salas.

## Contraseñas

Las contraseñas de las salas no se guardan en texto plano. Se guarda un hash PBKDF2-SHA256 con salt aleatorio. Los tokens de host y jugador también se almacenan solo como SHA-256.

## Despliegue

1. Crear una D1 llamada `ml3d-link-lab`.
2. Ejecutar `schema.sql` en esa D1.
3. Crear un Worker separado llamado `ml3d-link-lab`.
4. Añadir un binding D1 llamado `DB` apuntando a `ml3d-link-lab`.
5. Establecer `ALLOWED_ORIGIN=https://makinglayers3d-a11y.github.io`.
6. Desplegar `src/index.js`.
7. Comprobar `GET /v1/health`.

`wrangler.toml.example` contiene la configuración equivalente para despliegue con Wrangler.

## Caducidad

El host renueva la sala cada 20 s. Una sala o solicitud sin actividad caduca aproximadamente a los 2 minutos, para que las salas abandonadas desaparezcan del buscador.
