# Dixit cards

Página estática. Con una foto de algo cotidiano —hecha con la cámara o elegida de la galería— compone una carta ilustrada en el propio navegador y la guarda en una galería local.

El aspecto busca una ilustración de cuento, pictórica y de color rico, a partir de la foto que aporta quien usa la página. No incluye ilustraciones ni el logotipo de ningún juego.

## Qué hace

- Abre la cámara del dispositivo, si el navegador lo permite, o deja elegir una imagen. Si la cámara se bloquea, la subida sigue funcionando.
- Aplica un filtro en el cliente: color, bordes y textura, hasta donde llega un tratamiento en el navegador. No hay servidor ni modelo remoto.
- Muestra el resultado como una carta de 80 × 120 mm (2:3, PNG de 1024 × 1536 px) con la ilustración a sangre y las esquinas redondeadas, sin marco ni texto, y permite guardarla.
- La galería vive en este dispositivo (IndexedDB). Cada carta se puede descargar en PNG.

Las cartas no se envían a ningún sitio. Si se borran los datos del navegador, desaparecen.

## GitHub Pages

El sitio es HTML, CSS y JavaScript, sin compilación. GitHub Pages debe servir la rama `main` desde la raíz del repositorio (`/`).

Archivo de entrada: `index.html`.

En el repositorio: Settings → Pages → Build and deployment → Deploy from a branch → Branch `main` y carpeta `/ (root)` → Save.

Las fuentes (Fraunces y Outfit) se sirven desde el propio sitio bajo la licencia SIL Open Font License. Los textos están en `fonts/`.
