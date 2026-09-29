# Dónde estamos — 29 de septiembre de 2026

Rama de trabajo: **`proteger-contenido-2026-09-29`**
Última cosa hecha: el worker ya sabe entregar contenido protegido (commit `9242cb9`).

---

## Lo que ya está terminado

### El Cable Link, fusionado a `main`

Esto quedó cerrado antes de empezar con la protección del contenido.

- `main` = `ed6baa8`, con el motor mGBA dentro del repositorio.
- Punto de retorno: la etiqueta **`antes-de-mgba-link-2026-09-29`** (`92a0ae4`).
- Para deshacerlo: `git revert -m 1 ed6baa8`.

### Fase 1, paso 1: la copia de seguridad

**Hecha y verificada.** Está en `C:\AI\copia-contenido-protegido`:

- 130 ficheros, 584 MB (577 MB de juegos, 2,7 MB de carátulas, 4,5 MB de carcasas).
- Comprobada **byte a byte** contra el repositorio: cero diferencias.
- Lleva dentro `manifiesto.sha256`. Para volver a comprobarla en cualquier
  momento, desde esa carpeta: `sha256sum -c manifiesto.sha256`

Esta copia es la red de seguridad de todo lo demás. No la borres.

### Fase 1, paso 3 (la parte del servidor)

El worker ya sabe entregar el contenido comprobando quién lo pide. Ficheros:

- `cloudflare-access-worker/src/content.js` — nuevo, toda la lógica de acceso.
- `cloudflare-access-worker/src/index.js` — cuatro rutas nuevas enganchadas.

Cómo funciona, en corto: el contenido vivirá en un almacén privado sin
direcciones públicas. Cuando el emulador pide un juego, el worker mira quién es
(reutilizando tu sistema de firma de siempre), consulta en tu base de datos si
tiene acceso y si ese juego concreto le está permitido, y solo entonces se lo
manda. Si no, dice que no.

Dos decisiones que conviene que conozcas:

- **Los permisos se releen en cada petición.** Si revocas un acceso desde tu app
  de gestión, deja de funcionar al momento, sin esperas.
- **Los archivos pasan por el worker** en vez de dar un enlace temporal. Así no
  existe nunca una dirección que alguien pueda copiar y repartir, ni siquiera
  una que caduque.
- **Si algo está mal configurado, el contenido queda cerrado**, no abierto. Un
  fallo de configuración no debe abrir la puerta.

---

## Lo que falta de la fase 1

### Paso 2: el almacén en Cloudflare R2 — **te necesito aquí**

No puedo seguir solo. Hace falta que tú:

1. Actives **R2** en tu cuenta de Cloudflare. Los 584 MB caben de sobra en la
   capa gratuita (10 GB), pero activarlo **pide un método de pago** aunque no
   se cobre. Como acordamos que pararía ante cualquier coste, aquí paro.
2. Crees un bucket llamado **`ml3d-contenido`** (o me digas otro nombre).
3. Me confirmes que el token que ya usa GitHub Actions tiene permiso sobre R2,
   o me des uno que lo tenga.

Con eso, subo los 584 MB y sigo. El worker ya está preparado: si el bucket no
existe, se despliega igual y el contenido responde "no configurado" en vez de
romper el resto de la API.

### Paso 4: la app

Sin empezar. Es lo siguiente en cuanto el almacén exista. Consiste en que la
app pida los juegos, las carátulas y las carcasas al worker en vez de a la
carpeta pública, y que quien no tenga acceso vea la carcasa de ML3D, la
biblioteca vacía y un aviso claro.

### Paso 5: las pruebas

Sin empezar. Serán: tester, sin acceso, pedir un archivo a pelo sin acceso
(tiene que fallar), revocar y volver a dar acceso, Cable Link, etiquetas NFC,
guardados y juego normal.

---

## Dos cosas que descubrí y que cambian el plan

### 1. Tu app de Android depende del repositorio público

El escritor de etiquetas NFC pide la lista de juegos a la API de GitHub:

```
https://api.github.com/repos/makinglayers3d-a11y/gba-nfc/contents/games?ref=main
```

Cuando el repositorio pase a privado o quitemos la carpeta `games/`, **la app
instalada dejará de ver el catálogo**. No estaba contemplado en el plan.

También apunta a `assets/gba-sp-silver.jpg`, que es una de las carcasas que
vamos a proteger, y a `nfc-catalog.json` y `writer-update.json`.

Hay que decidir: o el worker le ofrece una lista equivalente, o hay que
actualizar la app. Lo hablamos antes del paso 4.

### 2. No sé el formato exacto de las etiquetas ya grabadas

Sé que llevan **una dirección web** (el escritor usa registros de tipo URI) y
que la base es `https://makinglayers3d-a11y.github.io/gba-nfc/`. Lo que no he
podido sacar del archivo de la app es qué se le añade detrás.

**No pienso adivinarlo.** El plan es hacer el sistema tolerante a cualquier
formato razonable, para no depender de acertar:

- Que la web acepte el nombre del juego venga como venga en la dirección.
- Que una dirección que apunte directamente a un archivo (por ejemplo
  `/gba-nfc/games/Mario Kart.gba`) **redirija** al emulador con ese juego
  puesto, en vez de dar error.

Eso se consigue con una página de "no encontrado" que reconduzca. Así funcionan
todas las etiquetas sin saber cuál lleva qué.

Si en algún momento escaneas una etiqueta y me dices qué dirección sale, mejor:
podré comprobarlo en vez de cubrirme.

---

## Una limitación de las pruebas que debes conocer

En este ordenador no hay Node ni wrangler instalados, así que **no puedo
ejecutar el worker en local**. La lógica de acceso solo se podrá probar de
verdad cuando esté desplegada.

Lo que sí puedo probar en local es toda la parte de la app, simulando las
respuestas del worker con el servidor de pruebas.

---

## Recordatorio: esto reduce la exposición, no la cambia de naturaleza

Proteger el contenido te da control real sobre quién accede y quita las ROMs
de un repositorio público. Sigue siendo distribución de juegos comerciales, solo
que a un grupo cerrado. La decisión es tuya; el trabajo está hecho para que sea
sólido.

---

## Para retomar mañana

1. Ponte en la rama: `git checkout proteger-contenido-2026-09-29`
2. Dime si has activado R2 y con qué nombre de bucket.
3. Decidimos qué hacer con la app de Android (punto 1 de arriba).
4. Sigo por el paso 4: la app.
