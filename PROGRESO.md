# Dónde estamos — 30 de septiembre de 2026

Rama de trabajo: **`proteger-contenido-2026-09-29`**

---

## Tres cosas me tienen parado

### 1. Al token de Cloudflare le falta permiso de R2

Lancé la subida del contenido y Cloudflare la rechazó. El mensaje exacto:

```
A request to the Cloudflare API (/accounts/27cf5.../r2/buckets) failed.
Authentication error [code: 10000]
Please ensure it has the correct permissions for this operation.
```

El token `CLOUDFLARE_API_TOKEN` que ya tienes guardado en GitHub funciona para
la base de datos y el worker, pero **no tiene permiso sobre R2**. El bucket
puede estar perfectamente creado: el token ni siquiera puede mirar la lista.

**Qué hace falta:** en el panel de Cloudflare, editar ese token y añadirle el
permiso **R2 → Edit** (o crear uno nuevo con él y reemplazar el secreto en
GitHub). Con eso relanzo la subida y sigue todo solo.

### 2. El formato de las etiquetas NFC sigue sin confirmarse

Me dijiste que los enlaces y sus variantes se ven en el repositorio principal o
en el privado de la app. **En el principal no están**: solo aparece la dirección
base, sin nada detrás. También descargué y examiné la versión actual del APK
(0.11.18) y tampoco salen.

Necesito una de estas dos: acceso al repositorio privado de la app, o que
escanees una etiqueta y me digas qué dirección abre.

**Mientras tanto no está bloqueado**: he hecho el rescate tolerante, que
funciona sin saber el formato (ver abajo).

### 3. La extensión de Chrome se ha desconectado

No puedo probar nada en el navegador ahora mismo. Las pruebas que dependen de
verlo funcionando quedan pendientes.

---

## Lo que sí ha avanzado hoy

### El worker ya entrega contenido protegido

`cloudflare-access-worker/src/content.js` y cuatro rutas nuevas. Comprueba en el
servidor quién pide qué, relee los permisos en cada petición (revocar surte
efecto al momento) y sirve los archivos por streaming, sin que exista nunca una
dirección pública.

### La app ya sabe pedirle el contenido

`ml3d-contenido.js` centraliza de dónde sale todo. Es la única pieza que sabe
dónde vive el contenido, así que un cambio futuro se toca en un sitio.
`dev-access.js` publica el pase y la dirección del worker.

### Las etiquetas NFC antiguas quedan rescatadas

`404.html`. Cuando una dirección deje de existir, esta página adivina a qué
juego se refería y abre el emulador con él. Cubre tres formas —ruta a un juego,
ruta a una carátula, y el nombre suelto al final— **sin necesitar saber cuál
lleva cada etiqueta**.

Comprobado en local: cuatro rutas inexistentes devuelven la página de rescate.
Falta ver el salto en el navegador (bloqueo 3).

`dev-server.ps1` ahora imita a GitHub Pages sirviendo 404.html, que es lo que
hace posible probarlo.

---

## Lo que falta de la fase 1

| Paso | Estado |
|---|---|
| 1. Copia de seguridad | **Hecha y verificada** (130 ficheros, byte a byte) |
| 2. Subir a R2 | **Parado**: falta permiso en el token |
| 3. Worker | **Hecho** |
| 4. App | A medias: falta que use `ml3d-contenido.js` para la biblioteca, las carátulas y las carcasas, y el aviso de "sin acceso" |
| 5. Pruebas | Sin empezar |

También falta el aviso del Cable Link cuando un tester juega con alguien sin
acceso.

---

## Sigue pendiente de decidir

Tu app de Android pide la lista de juegos a la API de GitHub:

```
https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games?ref=main
```

Cuando el repositorio sea privado, dejará de ver el catálogo. O el worker le
ofrece una lista equivalente, o hay que actualizar la app.

---

## La copia de seguridad, por si acaso

Sigue intacta en `C:\AI\copia-contenido-protegido`: 130 ficheros, 584 MB, con
`manifiesto.sha256` para comprobarla cuando quieras. No la borres.

---

## Para retomar

1. `git checkout proteger-contenido-2026-09-29`
2. Añade el permiso de R2 al token y avísame: relanzo la subida.
3. Dime cómo llegamos al formato de las etiquetas.
