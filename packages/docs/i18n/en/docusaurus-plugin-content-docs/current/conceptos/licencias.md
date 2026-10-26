---
title: "Media licenses"
description: "What you get when you buy a file through Kiba: a license document (file, terms, price) whose fingerprint travels in the Stellar payment. Templates, verification and how to declare it as a publisher."
slug: /licencias
---

# Media licenses

When your assistant buys a file through Kiba (a photo, a music track, a 3D model, a document), it gets the file and a **license**: a document stating who bought what, under which terms and for how much. The proof is the payment: the Stellar transaction that paid for that call carries the document's fingerprint. There is no certificate, no token and no signature to trust. The transaction is the proof and the document is what it proves.

## What you receive

Your assistant searches every catalog for free with the `search_media` tool and buys an item with `call_agent` and `{ assetId }`. Searching by calling the service with `call_agent` charges its base price.

| Piece | What it is | Where it is |
|---|---|---|
| The file | A signed, expiring download link from the service that sells it | In the assistant's reply and under **Results** in the dashboard |
| The license document | Plain JSON: buyer, seller, SHA-256 of the file, terms, price | `https://api.kiba.tools/v1/licenses/<id>/document` (public) |
| The payment | The Stellar transaction that paid for the call. Its `reference` argument is the first 8 bytes of the document's SHA-256 | Explorer link in the reply and in the dashboard |
| The verification | Checks the document, the payment and the status | `https://app.kiba.tools/verify/<id>` |

The document identifies the buyer by their Kiba account (not by name or email) and, if they have a payments wallet, by their Stellar address.

## Terms

Fields: permitted uses, who may use it, territory, duration, attribution, exclusive, transferable, notes and a URL for the full terms.

Permitted uses: `advertising`, `social-media`, `broadcast` (TV, radio, streaming), `print`, `merchandise` (products for sale), `editorial` (news, blogs, documentaries) and `web` (sites and apps).

| Template | Uses | Who may use it | Attribution |
|---|---|---|---|
| `personal` | web, social-media, print | personal, educational, non-commercial | No |
| `commercial` | all | commercial and personal | No |
| `commercial-attribution` | all | commercial and personal | **Yes** (the exact text comes in the document) |

No template is exclusive or transferable, and none allows reselling the file as is. A publisher can adjust any field per item.

### AI-generated media

Generator services (such as `music-generator`) also deliver a license, and it tells the truth about what it is: commercial use, **non-exclusive and not unique** (the provider may generate the same or something similar for someone else). If a file carries a provenance watermark, the license says so in the notes.

## How to verify a license

1. Open `https://app.kiba.tools/verify/<id>` (the `<id>` starts with `lic_` and comes with the reply). You will see whether the document matches its fingerprint, whether the payment exists on Stellar and carries that fingerprint, and whether the license has been revoked.
2. Without trusting Kiba: download the document, compute its SHA-256, open the transaction in a Stellar explorer and compare the fourth argument of `pay` (`reference`) with the first 8 bytes of the hash read as an integer. Also compare the SHA-256 of the file you have with `asset.sha256`.

## Refunds and revocation

If the service fails, the call is refunded to your balance and no license is issued. If a purchase is refunded or a publisher withdraws a file after a rights claim, Kiba marks the license as **revoked** and the verification will say so. The transaction does not change. Earlier licenses of other buyers are not affected.

## For publishers: how to declare the license

Two ways, both with the SDK:

**A service that generates or delivers files.** Declare default terms in `license` and return a `license` block with the file hash in every response:

```ts
const agent = new AgentProvider({
  service: 'my-generator',
  pricePerCall: 0.05,
  license: { name: 'commercial', notes: 'AI-generated; non-exclusive.' },
  // ...
});
agent.serve(async (req) => {
  const file = await generate(req);
  return {
    downloadUrl: file.url,
    license: { assetSha256: sha256Hex(file.bytes), filename: file.name, mimeType: file.mime, bytes: file.bytes.length },
  };
});
```

**A catalog of your own files.** Put the files in a folder with an `items.csv` and use `MediaCatalogProvider`:

```csv
id,file,title,type,tags,price_usd,license,attribution,attribution_text,description,preview
sunset,sunset.jpg,Sunset in Bogotá,image,bogota;sky,0.5,commercial,,,"Photo, 2026",sunset.preview.jpg
lofi-01,lofi-01.mp3,Lo-fi 01,audio,lofi;beat,0.1,commercial-attribution,true,Music: Ana,,lofi-01.preview.mp3
```

```ts
const source = await FolderSource.open({ dir: './catalog', publicBaseUrl: PUBLIC_ENDPOINT });
const agent = new MediaCatalogProvider({ service: 'anas-photos', pricePerCall: 0.05, source, license: { name: 'commercial' }, /* ... */ });
```

Each item is charged at its `price_usd`; items without one, at `pricePerCall`.

Search and item details are public and free (`GET /catalog/search?q=…`); Kiba uses them for the federated `search_media` search. Buying is a paid call with `{ assetId }`. Kiba writes the buyer's document with the hash and the terms you declared, and the payment carries its fingerprint.

**A catalog you already have behind your own API.** If your company already has its catalog behind an HTTP API, don't migrate it: use `HttpCatalogSource`. You give it your API's base URL, the headers with your key and a `map` function that turns each record of your API into a Kiba item:

```ts
import { HttpCatalogSource, MediaCatalogProvider } from 'kiba-sdk';

interface MyApiItem { sku: string; name: string; price_cents: number; thumbnail_url?: string }

const source = new HttpCatalogSource<MyApiItem>({
  baseUrl: 'https://api.mycompany.com/v1',
  headers: { Authorization: `Bearer ${process.env.COMPANY_API_KEY}` },
  listPath: 'items', // returns an array or { items | data | results: [] }
  map: (raw) => ({
    id: raw.sku,
    title: raw.name,
    type: 'image',
    priceUsd: raw.price_cents / 100,
    previewUrl: raw.thumbnail_url,
    downloadPath: `items/${raw.sku}/download-link`, // your API answers { url, sha256?, bytes? }
  }),
  publicBaseUrl: PUBLIC_ENDPOINT,
});
const agent = new MediaCatalogProvider({ service: 'my-company-photos', pricePerCall: 0.05, source, license: { name: 'commercial' }, /* ... */ });
```

- **Cache.** The catalog is loaded the first time it is used and reloaded in the background every 5 minutes (`refreshMs`). If your API fails during a reload, the last good copy keeps being served. Search runs in memory, without calling your API.
- **A fresh link on every purchase.** With `downloadPath`, the link is requested from your API at purchase time, so your short-lived signed links work. If your links don't expire, return `downloadUrl` from `map` and it is delivered as is.
- **Hash.** If your API doesn't give the file's `sha256`, the file is downloaded once to compute it and kept in memory. `source.prehash()` computes it for the whole catalog at startup.
- **Your key never leaves your API.** The `headers` are only sent to the origin of `baseUrl`, never to other domains that appear in your responses (for example, the download CDN).
- **Your own pagination.** If your API paginates, pass `fetchItems: async (api) => …` instead of `listPath` and walk the pages with `api.getJson(path, query)`. A record that `map` can't translate is skipped with a warning; it doesn't bring down the catalog.

For other sources (S3, your own database), implement the `CatalogSource` interface (four functions). Kiba never connects to your database.

By publishing you declare that you hold the rights to what you sell and accept that Kiba revokes licenses after a substantiated claim.
