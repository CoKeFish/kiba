---
title: "Licencias de medios"
description: "Qué recibes al comprar un archivo por Kiba: una credencial verificable con los términos, el hash del archivo y el pago en Stellar. Plantillas, verificación y cómo declararla como publisher."
slug: /licencias
---

# Licencias de medios

Cuando tu asistente compra por Kiba un archivo (una foto, una pista de música, un modelo 3D, un documento), no recibe solo el archivo. Recibe también una **licencia**: una credencial verificable, firmada por Kiba, que dice quién compró qué, bajo qué términos y con qué pago. No es un token ni un NFT. Es un documento que cualquiera puede comprobar sin cuenta y sin conexión.

## Qué recibes al comprar

Tu asistente busca gratis en todos los catálogos con la herramienta `search_media` y compra un ítem con `call_agent` y `{ assetId }`. Buscar llamando al servicio con `call_agent` cobra su precio base.

| Pieza | Qué es | Dónde está |
|---|---|---|
| El archivo | Enlace de descarga (firmado, con caducidad) del servicio que lo vende | En la respuesta del asistente y en **Resultados** del dashboard |
| La credencial | Un documento W3C Verifiable Credential 2.0 (`MediaLicenseCredential`) firmado con Ed25519 | `https://api.kiba.tools/v1/licenses/<id>` (pública) |
| El certificado | La misma información en una página legible e imprimible | `…/v1/licenses/<id>/certificate` |
| La verificación | Comprobación de firma, emisor y estado, con enlace al pago en Stellar | `https://app.kiba.tools/verify/<id>` |

La credencial contiene: el identificador de tu cuenta de Kiba (no tu nombre ni tu correo), el servicio y el publisher, el **SHA-256 del archivo** (lo que identifica exactamente qué compraste), los términos, y como evidencia la llamada pagada y, cuando existe, el **hash de la transacción en Stellar**.

## Plantillas de términos

Los términos siguen la forma de [RSL 1.0](https://rslstandard.org/rsl), el estándar abierto de licencias legibles por máquina, para que la licencia pueda exportarse e incrustarse en los metadatos del archivo.

| Plantilla | Quién puede usarlo | Atribución | Exclusiva | Transferible | Duración |
|---|---|---|---|---|---|
| `personal` | Uso personal, educativo y no comercial | No | No | No | Perpetua |
| `commercial` | Uso comercial y personal | No | No | No | Perpetua |
| `commercial-attribution` | Uso comercial y personal | **Sí** (el texto exacto viene en la credencial) | No | No | Perpetua |

Un publisher puede ajustar cualquier campo por ítem (territorio, duración, notas, URL de los términos completos). Lo que ninguna plantilla permite: revender el archivo tal cual ni reclamar exclusividad.

### Medios generados con IA

Los servicios generadores (como `music-generator` o `3d-generator`) también entregan licencia, y dicen la verdad sobre lo que es: uso comercial, **no exclusivo y no único** (el proveedor puede generar algo igual o parecido para otra persona). Si un archivo lleva marca de agua de procedencia, la licencia lo indica en `notes`.

## Cómo verificar una licencia

1. Abre `https://app.kiba.tools/verify/<id>` (el `<id>` empieza por `lic_` y está en el certificado). Verás si la firma es válida, si la emitió Kiba, si no está revocada y si el pago está anclado en Stellar.
2. Si prefieres no confiar en la web de Kiba: descarga la credencial en `…/v1/licenses/<id>`, comprueba la firma `eddsa-jcs-2022` contra la clave del emisor (`issuer.id`, un `did:key` Ed25519), lee la lista de estado en `credentialStatus.statusListCredential` (Bitstring Status List) y abre la transacción de `evidence[0].txHash` en el explorador de Stellar.
3. Compara el SHA-256 del archivo que tienes con `credentialSubject.license.assetSha256`.

## Reembolsos y revocación

Si el servicio falla, la llamada se reembolsa a tu saldo y no se emite licencia. Una licencia ya emitida solo deja de valer si Kiba la revoca, por ejemplo ante una reclamación fundada de derechos: queda marcada como **revocada** en la lista de estado. La credencial sigue existiendo, pero la verificación lo dirá. Las licencias de otros compradores no se ven afectadas.

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

Cada ítem se cobra a su `price_usd`; los que no lo tienen, a `pricePerCall`. `pricePerCall` es además el mínimo: un ítem más barato se anuncia y se cobra a `pricePerCall`, así que ponlo igual o por debajo de tu ítem más barato.

La búsqueda y la ficha de cada ítem son públicas y gratis (`GET /catalog/search?q=…`); Kiba las usa para la búsqueda federada `search_media`. Comprar es una llamada pagada con `{ assetId }`. El gateway emite la credencial del comprador con el hash y los términos que tú declaraste. Si tu catálogo vive en S3, en tu propia base de datos o en un feed, implementa la interfaz `CatalogSource` (cuatro funciones); Kiba nunca se conecta a tu base de datos.

Al publicar declaras que tienes los derechos de lo que vendes y aceptas que Kiba revoque licencias ante una reclamación fundada.
