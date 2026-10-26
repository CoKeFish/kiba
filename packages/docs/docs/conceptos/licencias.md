---
title: "Licencias de medios"
description: "Qué recibes al comprar un archivo por Kiba: un documento de licencia (archivo, términos, precio) cuya huella viaja en el pago en Stellar. Plantillas, verificación y cómo declararla como publisher."
slug: /licencias
---

# Licencias de medios

Cuando tu asistente compra por Kiba un archivo (una foto, una pista de música, un modelo 3D, un documento), recibe el archivo y una **licencia**: un documento que dice quién compró qué, bajo qué términos y por cuánto. La prueba es el pago: la transacción en Stellar que pagó esa llamada lleva la huella del documento. No hay certificado, ni token, ni firma en la que confiar. La transacción es la prueba y el documento es lo que prueba.

## Qué recibes al comprar

Tu asistente busca gratis en todos los catálogos con la herramienta `search_media` y compra un ítem con `call_agent` y `{ assetId }`. Buscar llamando al servicio con `call_agent` cobra su precio base.

| Pieza | Qué es | Dónde está |
|---|---|---|
| El archivo | Enlace de descarga (firmado, con caducidad) del servicio que lo vende | En la respuesta del asistente y en **Resultados** del dashboard |
| El documento de licencia | JSON plano: comprador, vendedor, SHA-256 del archivo, términos, precio | `https://api.kiba.tools/v1/licenses/<id>/document` (público) |
| El pago | La transacción en Stellar que pagó la llamada. Su argumento `reference` son los primeros 8 bytes del SHA-256 del documento | Enlace al explorador en la respuesta y en el dashboard |
| La verificación | Comprueba el documento, el pago y el estado | `https://app.kiba.tools/verify/<id>` |

El documento identifica al comprador por su cuenta de Kiba (no por nombre ni correo) y, si tiene wallet de pagos, por su dirección Stellar.

## Términos

Campos: usos permitidos, quién puede usarlo, territorio, duración, atribución, exclusiva, transferible, notas y URL de los términos completos.

Usos permitidos: `advertising` (anuncios), `social-media` (redes sociales), `broadcast` (televisión, radio, streaming), `print` (impresión), `merchandise` (productos a la venta), `editorial` (noticias, blogs, documentales) y `web` (sitios y apps).

| Plantilla | Usos | Quién puede usarlo | Atribución |
|---|---|---|---|
| `personal` | web, social-media, print | personal, educativo, no comercial | No |
| `commercial` | todos | comercial y personal | No |
| `commercial-attribution` | todos | comercial y personal | **Sí** (el texto exacto viene en el documento) |

Ninguna plantilla es exclusiva ni transferible, y ninguna permite revender el archivo tal cual. Un publisher puede ajustar cualquier campo por ítem.

### Medios generados con IA

Los servicios generadores (como `music-generator`) también entregan licencia, y dicen la verdad sobre lo que es: uso comercial, **no exclusivo y no único** (el proveedor puede generar algo igual o parecido para otra persona). Si un archivo lleva marca de agua de procedencia, la licencia lo indica en las notas.

## Cómo verificar una licencia

1. Abre `https://app.kiba.tools/verify/<id>` (el `<id>` empieza por `lic_` y viene en la respuesta). Verás si el documento coincide con su huella, si el pago existe en Stellar y lleva esa huella, y si la licencia no está revocada.
2. Sin confiar en Kiba: descarga el documento, calcula su SHA-256, abre la transacción en el explorador de Stellar y compara el cuarto argumento de `pay` (`reference`) con los primeros 8 bytes del hash leídos como un entero. Compara también el SHA-256 del archivo que tienes con `asset.sha256`.

## Reembolsos y revocación

Si el servicio falla, la llamada se reembolsa a tu saldo y no se emite licencia. Si una compra se reembolsa o un publisher retira un archivo por una reclamación de derechos, Kiba marca la licencia como **revocada** y la verificación lo dirá. La transacción no cambia. Las licencias anteriores de otros compradores no se ven afectadas.

## Para publishers: cómo declarar la licencia

Dos maneras, ambas con el SDK:

**Un servicio que genera o entrega archivos.** Declara los términos por defecto en `license` y devuelve en cada respuesta un bloque `license` con el hash del archivo:

```ts
const agent = new AgentProvider({
  service: 'mi-generador',
  pricePerCall: 0.05,
  license: { name: 'commercial', notes: 'Generado con IA; no exclusivo.' },
  // ...
});
agent.serve(async (req) => {
  const file = await generar(req);
  return {
    downloadUrl: file.url,
    license: { assetSha256: sha256Hex(file.bytes), filename: file.name, mimeType: file.mime, bytes: file.bytes.length },
  };
});
```

**Un catálogo de archivos propios.** Pon los archivos en una carpeta con un `items.csv` y usa `MediaCatalogProvider`:

```csv
id,file,title,type,tags,price_usd,license,attribution,attribution_text,description,preview
atardecer,atardecer.jpg,Atardecer en Bogotá,image,bogota;cielo,0.5,commercial,,,"Foto, 2026",atardecer.preview.jpg
lofi-01,lofi-01.mp3,Lo-fi 01,audio,lofi;beat,0.1,commercial-attribution,true,Música: Ana,,lofi-01.preview.mp3
```

```ts
const source = await FolderSource.open({ dir: './catalogo', publicBaseUrl: PUBLIC_ENDPOINT });
const agent = new MediaCatalogProvider({ service: 'fotos-de-ana', pricePerCall: 0.05, source, license: { name: 'commercial' }, /* ... */ });
```

Cada ítem se cobra a su `price_usd`; los que no lo tienen, a `pricePerCall`.

La búsqueda y la ficha de cada ítem son públicas y gratis (`GET /catalog/search?q=…`); Kiba las usa para la búsqueda federada `search_media`. Comprar es una llamada pagada con `{ assetId }`. Kiba escribe el documento del comprador con el hash y los términos que tú declaraste, y el pago lleva su huella. Si tu catálogo vive en S3, en tu propia base de datos o en un feed, implementa la interfaz `CatalogSource` (cuatro funciones); Kiba nunca se conecta a tu base de datos.

Al publicar declaras que tienes los derechos de lo que vendes y aceptas que Kiba revoque licencias ante una reclamación fundada.
