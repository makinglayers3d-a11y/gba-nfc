# Avatar por capas (ML3D Link)

Hojas 4×4: columnas = frames 0..3 del paso; filas = down, up, left, right.
- `x2/` → frames de 64×96 (resolución recomendada, la que usa el lobby)
- `x1/` → frames de 32×48

Por cuerpo (`female/`, `male/`):
- `base.png`   cuerpo sin ojos, piel recoloreable
- `eyes/`      8 formas de ojos (estilo de la base original)
- `hair/`      9 peinados

Orden de capas: base → eyes → (ropa) → hair.
`avatar.json` define colores clave, presets, nombres y archivos.
Recolor: `makeSkinPalette`, `makeEyePalette`, `makeHairPalette` en `link-lab/avatar-layers.js`.
