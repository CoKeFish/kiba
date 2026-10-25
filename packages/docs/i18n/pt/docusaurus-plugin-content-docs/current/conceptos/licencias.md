---
title: "Licenças de mídia"
description: "O que você recebe ao comprar um arquivo pela Kiba: uma credencial verificável com os termos, o hash do arquivo e o pagamento na Stellar. Modelos, verificação e como declará-la como publisher."
slug: /licencias
---

# Licenças de mídia

Quando o seu assistente compra pela Kiba um arquivo (uma foto, uma faixa de música, um modelo 3D, um documento), ele não recebe só o arquivo. Recebe também uma **licença**: uma credencial verificável, assinada pela Kiba, que diz quem comprou o quê, sob quais termos e com qual pagamento. Não é um token nem um NFT. É um documento que qualquer pessoa pode conferir sem conta e sem conexão, e que é revogado em caso de reembolso.

## O que você recebe

| Peça | O que é | Onde está |
|---|---|---|
| O arquivo | Link de download (assinado, com validade) do serviço que o vende | Na resposta do assistente e em **Resultados** no dashboard |
| A credencial | Um documento W3C Verifiable Credential 2.0 (`MediaLicenseCredential`) assinado com Ed25519 | `https://api.kiba.tools/v1/licenses/<id>` (pública) |
| O certificado | A mesma informação em uma página legível e imprimível | `…/v1/licenses/<id>/certificate` |
| A verificação | Conferência de assinatura, emissor e status, com link para o pagamento na Stellar | `https://app.kiba.tools/verify/<id>` |

A credencial contém: o identificador da sua conta Kiba (não o seu nome nem o seu e-mail), o serviço e o publisher, o **SHA-256 do arquivo** (exatamente o que você comprou), os termos e, como evidência, a chamada paga e, quando existe, o **hash da transação na Stellar**.

## Modelos de termos

Os termos seguem a forma do [RSL 1.0](https://rslstandard.org/rsl), o padrão aberto de licenças legíveis por máquina, para que a licença possa ser exportada e embutida nos metadados do arquivo.

| Modelo | Quem pode usar | Atribuição | Exclusiva | Transferível | Duração |
|---|---|---|---|---|---|
| `personal` | Uso pessoal, educacional e não comercial | Não | Não | Não | Perpétua |
| `commercial` | Uso comercial e pessoal | Não | Não | Não | Perpétua |
| `commercial-attribution` | Uso comercial e pessoal | **Sim** (o texto exato vai na credencial) | Não | Não | Perpétua |

Um publisher pode ajustar qualquer campo por item (território, duração, notas, URL dos termos completos). O que nenhum modelo permite: revender o arquivo como está nem reivindicar exclusividade.

### Mídia gerada por IA

Os serviços geradores (como `music-generator` ou `3d-generator`) também entregam licença, e dizem a verdade sobre o que é: uso comercial, **não exclusivo e não único** (o provedor pode gerar algo igual ou parecido para outra pessoa). Se um arquivo leva marca d'água de procedência, a licença indica isso em `notes`.

## Como verificar uma licença

1. Abra `https://app.kiba.tools/verify/<id>` (o `<id>` começa com `lic_` e está no certificado). Você verá se a assinatura é válida, se foi emitida pela Kiba, se não está revogada e se o pagamento está ancorado na Stellar.
2. Se preferir não confiar no site da Kiba: baixe a credencial em `…/v1/licenses/<id>`, verifique a assinatura `eddsa-jcs-2022` contra a chave do emissor (`issuer.id`, um `did:key` Ed25519), leia a lista de status em `credentialStatus.statusListCredential` (Bitstring Status List) e abra a transação de `evidence[0].txHash` em um explorador da Stellar.
3. Compare o SHA-256 do arquivo que você tem com `credentialSubject.license.assetSha256`.

## Reembolsos e revogação

Se uma compra for reembolsada, ou um publisher retirar um arquivo após uma reivindicação de direitos, a Kiba marca a licença como **revogada** na lista de status. A credencial continua existindo, mas a verificação dirá isso. As licenças anteriores de outros compradores não são afetadas.

## Para publishers: como declarar a licença

Duas formas, ambas com o SDK:

**Um serviço que gera ou entrega arquivos.** Declare os termos padrão em `license` e devolva em cada resposta um bloco `license` com o hash do arquivo:

```ts
const agent = new AgentProvider({
  service: 'meu-gerador',
  pricePerCall: 0.05,
  license: { name: 'commercial', notes: 'Gerado por IA; não exclusivo.' },
  // ...
});
agent.serve(async (req) => {
  const file = await gerar(req);
  return {
    downloadUrl: file.url,
    license: { assetSha256: sha256Hex(file.bytes), filename: file.name, mimeType: file.mime, bytes: file.bytes.length },
  };
});
```

**Um catálogo de arquivos próprios.** Coloque os arquivos em uma pasta com um `items.csv` e use `MediaCatalogProvider`:

```csv
id,file,title,type,tags,price_usd,license,attribution,attribution_text,description,preview
entardecer,entardecer.jpg,Entardecer em Bogotá,image,bogota;ceu,0.5,commercial,,,"Foto, 2026",entardecer.preview.jpg
lofi-01,lofi-01.mp3,Lo-fi 01,audio,lofi;beat,0.1,commercial-attribution,true,Música: Ana,,lofi-01.preview.mp3
```

```ts
const source = await FolderSource.open({ dir: './catalogo', publicBaseUrl: PUBLIC_ENDPOINT });
const agent = new MediaCatalogProvider({ service: 'fotos-da-ana', pricePerCall: 0.05, source, license: { name: 'commercial' }, /* ... */ });
```

A busca e a ficha de cada item são públicas e gratuitas (`GET /catalog/search?q=…`); comprar é uma chamada paga com `{ assetId }`. O gateway emite a credencial do comprador com o hash e os termos que você declarou. Se o seu catálogo vive no S3, no seu próprio banco de dados ou em um feed, implemente a interface `CatalogSource` (quatro funções); a Kiba nunca se conecta ao seu banco de dados.

Ao publicar, você declara que detém os direitos do que vende e aceita que a Kiba revogue licenças após uma reivindicação fundamentada.
