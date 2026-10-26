# Andes Stock (empresa simulada)

Catálogo de demo de **Andes Stock**, una empresa de fotos de stock **simulada** para mostrar cómo una empresa que ya existe vende por Kiba sin migrar su catálogo. `catalog.json` está en el formato propio de "la empresa" (sku, name, keywords, price_cents, license_code…), distinto del de Kiba: el agente `andes-stock` (`src/andes-stock.ts`) sirve esta carpeta como si fuera la API existente de la empresa (`/company-api/v1`) y la conecta a Kiba con `HttpCatalogSource` y una función `map`.

El contenido es propio del equipo: fotos generadas con IA (Gemini) y música compuesta por síntesis en código. Los nombres de autores son ficticios.
