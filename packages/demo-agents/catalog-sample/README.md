# Catálogo de muestra

Contenido propio del equipo para desarrollar y demostrar el servicio `media-catalog`, sin material de terceros:

- **Imágenes:** generadas con IA (Gemini) por el equipo y optimizadas para la web (≤ 1600 px, con miniatura `*.preview.jpg`).
- **Música:** compuesta por síntesis en código (sin samples ni grabaciones), en MP3 con una vista previa de 14 s (`*.preview.mp3`).

Las descripciones de `items.csv` lo dicen en cada ítem. Para usar material propio, pon los archivos en esta carpeta (o en la que indique `CATALOG_DIR`) y descríbelos en `items.csv` (columnas: id, file, title, type, tags, price_usd, license, attribution, attribution_text, description, preview). Ningún `price_usd` puede ser menor que el precio mínimo del servicio (`CATALOG_PRICE_USDC`, 0.02 por defecto).
