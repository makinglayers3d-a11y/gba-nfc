# Qué tiene que cambiar en la app de Android

Este documento es para quien programe el escritor de etiquetas NFC. Describe
qué debe hacer la versión nueva y por qué.

**El código de la app está en un repositorio privado al que no tengo acceso, así
que no he podido hacer estos cambios.** Aquí queda todo lo que hace falta
saber, y el lado del servidor ya está listo y esperando.

---

## El problema

Hoy la app pide la lista de juegos a la API de GitHub:

```
https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games?ref=main
```

Eso funciona porque el repositorio es público y los juegos están dentro. Cuando
el contenido se mude a un almacén privado y el repositorio pase a privado, esa
llamada devolverá 404 y **la app se quedará sin catálogo**.

La app también carga una carcasa desde el sitio público:

```
https://makinglayers3d-a11y.github.io/gba-nfc/assets/gba-sp-silver.jpg?v=5
```

Esa imagen es una de las protegidas, así que también dejará de estar ahí.

---

## Lo que tiene que hacer la versión nueva

Lo mismo que hace la web: identificarse con su firma y pedirle todo al worker.

### 1. Identificarse (esto ya lo hace)

La app ya tiene su par de claves y ya se verifica contra
`https://ml3d-dev-access.makinglayers3d.workers.dev`. No cambia nada ahí.

Lo único nuevo: la respuesta de `/v1/access/verify` ahora trae un campo más.

```json
{
  "approved": true,
  "policy": { "...": "..." },
  "deviceId": "...",
  "contentPass": "eyJ...abc.def..."
}
```

Ese `contentPass` es el pase para pedir contenido. Dura 30 minutos; cuando
caduque, basta con volver a verificarse para conseguir otro.

### 2. Pedir el catálogo al worker

En lugar de la API de GitHub:

```
GET /v1/content/catalog
Cabecera:  X-ML3D-Content-Pass: <el contentPass>
```

Respuesta:

```json
{
  "ok": true,
  "acceso": true,
  "juegos": ["Mario Kart - Super Circuit.gba", "..."],
  "carcasas": ["ml3d", "silver", "..."]
}
```

La lista ya viene filtrada según lo que ese dispositivo tiene permitido. Si no
hay acceso, `acceso` es `false`, `juegos` viene vacío y llega un `mensaje` que
se puede enseñar tal cual.

### 3. Pedir las imágenes y los juegos al worker

| Antes | Ahora |
|---|---|
| `.../gba-nfc/games/<archivo>` | `GET /v1/content/rom/<archivo>` |
| `.../gba-nfc/covers/<archivo>` | `GET /v1/content/cover/<archivo>` |
| `.../gba-nfc/assets/gba-sp-silver.jpg` | `GET /v1/content/skin/silver` |

Todas con la cabecera `X-ML3D-Content-Pass`. Si la imagen se carga desde un
componente que no permite cabeceras, el pase también vale como parámetro:
`?pase=<el contentPass>`.

**Excepción:** la carcasa `ml3d` no necesita pase. Es diseño propio y se sirve a
cualquiera, precisamente para que la app tenga algo que enseñar aunque el
dispositivo no tenga acceso.

### 4. Avisar cuando la versión se quede corta

`writer-update.json` tiene ahora dos campos nuevos:

```json
{
  "versionCode": 36,
  "minVersionCode": 36,
  "updateRequiredMessage": "Esta version ya no puede ver el catalogo..."
}
```

Si el `versionCode` de la app instalada es **menor** que `minVersionCode`, la
app debe enseñar `updateRequiredMessage` y el botón de actualizar, en lugar de
quedarse con una lista vacía sin explicación.

Ahora mismo los dos valores son iguales a propósito: **nadie recibe el aviso
todavía**. Se sube `minVersionCode` a 37 el día que se publique la versión nueva
y se retire el contenido público, no antes.

---

## Qué NO cambia

- La forma de grabar las etiquetas. Los registros NDEF siguen igual.
- Las etiquetas ya grabadas. Se han cubierto aparte, con una página de rescate
  en la web que las reconduce aunque apunten a archivos que ya no existen.
- El sistema de accesos, los permisos y tu app de gestión.

---

## Orden recomendado para no dejar a nadie tirado

Esto importa, porque si se hace al revés los testers se quedan sin servicio:

1. **Publicar la versión nueva de la app** (la que habla con el worker).
2. **Dar tiempo** a que los testers actualicen. El propio sistema de
   actualización de la app ya les avisa.
3. **Subir `minVersionCode` a 37**, para que quien no haya actualizado vea el
   aviso en vez de una lista vacía.
4. **Solo entonces**, retirar el contenido del repositorio público y ponerlo
   privado.

Mientras los pasos 1 a 3 no estén hechos, el contenido tiene que seguir donde
está. El worker ya sirve el contenido protegido, así que la versión nueva se
puede desarrollar y probar sin prisa: las dos formas conviven.

---

## Cómo hacer llegar la versión nueva a los testers

La app ya tiene actualización automática: consulta `writer-update.json` y ofrece
descargar la nueva. El proceso es el de siempre:

1. Compilar el APK nuevo con un `versionCode` de 37.
2. Publicarlo como release en GitHub, igual que la 0.11.18.
3. Actualizar `writer-update.json` con la versión, la dirección de descarga, el
   `sha256` y el tamaño.

A partir de ahí, cada tester recibe el aviso al abrir la app.

Si alguno no actualiza, el paso 3 del orden de arriba hace que vea el mensaje en
vez de una app aparentemente rota.
