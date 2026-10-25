---
title: "Media licenses"
description: "What you get when you buy a file through Kiba: a verifiable credential with the terms, the file hash and the Stellar payment. Templates, verification and how to declare it as a publisher."
slug: /licencias
---

# Media licenses

When your assistant buys a file through Kiba (a photo, a music track, a 3D model, a document), it does not get only the file. It also gets a **license**: a verifiable credential, signed by Kiba, stating who bought what, under which terms and with which payment. It is not a token or an NFT. It is a document anyone can check without an account and without a connection.

## What you receive

Your assistant searches every catalog for free with the `search_media` tool and buys an item with `call_agent` and `{ assetId }`. Searching by calling the service with `call_agent` charges its base price.

| Piece | What it is | Where |
|---|---|---|
| The file | A signed, expiring download link from the service that sells it | In the assistant's reply and under **Results** in the dashboard |
| The credential | A W3C Verifiable Credential 2.0 (`MediaLicenseCredential`) signed with Ed25519 | `https://api.kiba.tools/v1/licenses/<id>` (public) |
| The certificate | The same information as a readable, printable page | `…/v1/licenses/<id>/certificate` |
| The verification | Signature, issuer and status checks, with a link to the Stellar payment | `https://app.kiba.tools/verify/<id>` |

The credential contains: your Kiba account identifier (not your name or email), the service and the publisher, the **SHA-256 of the file** (exactly what you bought), the terms, and as evidence the paid call and, when available, the **Stellar transaction hash**.

## Term templates

Terms follow the shape of [RSL 1.0](https://rslstandard.org/rsl), the open standard for machine-readable licenses, so a license can be exported and embedded in the file's metadata.

| Template | Who may use it | Attribution | Exclusive | Transferable | Duration |
|---|---|---|---|---|---|
| `personal` | Personal, educational and non-commercial use | No | No | No | Perpetual |
| `commercial` | Commercial and personal use | No | No | No | Perpetual |
| `commercial-attribution` | Commercial and personal use | **Yes** (the exact text travels in the credential) | No | No | Perpetual |

A publisher can adjust any field per item (territory, duration, notes, URL of the full terms). What no template allows: reselling the file as is, or claiming exclusivity.

### AI-generated media

Generator services (such as `music-generator` or `3d-generator`) also deliver a license, and they tell the truth about what it is: commercial use, **non-exclusive and not unique** (the provider may generate the same or similar content for someone else). If a file carries a provenance watermark, the license says so in `notes`.

## How to verify a license

1. Open `https://app.kiba.tools/verify/<id>` (the `<id>` starts with `lic_` and is printed on the certificate). You will see whether the signature is valid, whether Kiba issued it, whether it is revoked and whether the payment is anchored on Stellar.
2. If you prefer not to trust Kiba's website: download the credential at `…/v1/licenses/<id>`, verify the `eddsa-jcs-2022` signature against the issuer key (`issuer.id`, an Ed25519 `did:key`), read the status list at `credentialStatus.statusListCredential` (Bitstring Status List) and open the transaction in `evidence[0].txHash` on a Stellar explorer.
3. Compare the SHA-256 of the file you hold with `credentialSubject.license.assetSha256`.

## Refunds and revocation

If the service fails, the call is refunded to your balance and no license is issued. A license already issued only stops being valid if Kiba revokes it, for example after a well-founded rights claim: it is marked as **revoked** in the status list. The credential still exists, but verification will say so. Other buyers' licenses are not affected.

## For publishers: declaring the license

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
sunset,sunset.jpg,Sunset over Bogotá,image,bogota;sky,0.5,commercial,,,"Photo, 2026",sunset.preview.jpg
lofi-01,lofi-01.mp3,Lo-fi 01,audio,lofi;beat,0.1,commercial-attribution,true,Music: Ana,,lofi-01.preview.mp3
```

```ts
const source = await FolderSource.open({ dir: './catalog', publicBaseUrl: PUBLIC_ENDPOINT });
const agent = new MediaCatalogProvider({ service: 'anas-photos', pricePerCall: 0.05, source, license: { name: 'commercial' }, /* ... */ });
```

Each item is charged at its `price_usd`; items without one, at `pricePerCall`. `pricePerCall` is also the minimum: a cheaper item is listed and charged at `pricePerCall`, so set it at or below your cheapest item.

Search and item details are public and free (`GET /catalog/search?q=…`); Kiba uses them for the federated `search_media` search. Buying is a paid call with `{ assetId }`. The gateway issues the buyer's credential with the hash and the terms you declared. If your catalog lives in S3, in your own database or in a feed, implement the `CatalogSource` interface (four functions); Kiba never connects to your database.

By publishing you declare that you hold the rights to what you sell and accept that Kiba revokes licenses after a well-founded claim.
