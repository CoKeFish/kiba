# Fuentes de muestra (Tipos del Sur)

Catálogo del servicio `tipos-del-sur`, una fundición tipográfica **simulada** que vende sus fuentes por Kiba. Una IA no puede generar una fuente lista para usar, y su licencia depende de dónde se use (escritorio, web, apps), así que es un buen ejemplo de activo con licencia.

Las tres familias son propias del equipo: se **generaron por código** a partir de un esqueleto de trazos por letra en una cuadrícula de 5×7, dibujado de tres maneras (píxeles, trazo redondeado y stencil). No hay material de terceros.

| Archivo | Fuente | Licencia |
|---|---|---|
| `condor-pixel.otf` | Cóndor Pixel | `font-desktop`: escritorio, hasta 5 equipos |
| `cafe-redonda.otf` | Café Redonda | `font-web`: escritorio (2 equipos) + web hasta 10.000 visitas al mes |
| `cargo-stencil.otf` | Cargo Stencil | `font-full`: escritorio (10 equipos), web sin límite, apps y ebooks |

Son fuentes de titulares: solo mayúsculas (las minúsculas usan el mismo dibujo), con números, signos y acentos del español y el portugués.

Cada familia tiene una vista previa (`*.preview.otf`) con **solo las letras básicas**: sirve para probar la fuente en el catálogo sin entregar la fuente completa. La fuente completa (números, signos, acentos) se entrega con la compra.

Los metadatos están en `items.json` (los términos de cada licencia van como objeto en `license`).
