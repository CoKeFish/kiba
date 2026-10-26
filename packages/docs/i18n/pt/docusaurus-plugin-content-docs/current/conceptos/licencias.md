---
title: "Licenças de mídia"
description: "O que você recebe ao comprar um arquivo pela Kiba: um documento de licença (arquivo, termos, preço) cuja impressão digital viaja no pagamento na Stellar. Modelos, verificação e como declará-la como publisher."
slug: /licencias
---

# Licenças de mídia

Quando o seu assistente compra pela Kiba um arquivo (uma foto, uma faixa de música, um modelo 3D, um documento), ele recebe o arquivo e uma **licença**: um documento que diz quem comprou o quê, sob quais termos e por quanto. A prova é o pagamento: a transação na Stellar que pagou essa chamada carrega a impressão digital do documento. Não há certificado, nem token, nem assinatura em que confiar. A transação é a prova e o documento é o que ela prova.

## O que você recebe ao comprar

O seu assistente busca de graça em todos os catálogos com a ferramenta `search_media` e compra um item com `call_agent` e `{ assetId }`. Buscar chamando o serviço com `call_agent` cobra o preço base dele.

| Peça | O que é | Onde está |
|---|---|---|
| O arquivo | Link de download (assinado, com validade) do serviço que o vende | Na resposta do assistente e em **Resultados** no dashboard |
| O documento de licença | JSON simples: comprador, vendedor, SHA-256 do arquivo, termos, preço | `https://api.kiba.tools/v1/licenses/<id>/document` (público) |
| O pagamento | A transação na Stellar que pagou a chamada. Seu argumento `reference` são os primeiros 8 bytes do SHA-256 do documento | Link para o explorador na resposta e no dashboard |
| A verificação | Confere o documento, o pagamento e o estado | `https://app.kiba.tools/verify/<id>` |

O documento identifica o comprador pela sua conta na Kiba (não por nome nem e-mail) e, se ele tiver carteira de pagamentos, pelo seu endereço Stellar.

## Termos

Campos: usos permitidos, quem pode usar, território, duração, atribuição, exclusiva, transferível, notas e URL dos termos completos.

Usos permitidos: `advertising` (anúncios), `social-media` (redes sociais), `broadcast` (TV, rádio, streaming), `print` (impressão), `merchandise` (produtos à venda), `editorial` (notícias, blogs, documentários) e `web` (sites e apps).

| Modelo | Usos | Quem pode usar | Atribuição |
|---|---|---|---|
| `personal` | web, social-media, print | pessoal, educacional, não comercial | Não |
| `commercial` | todos | comercial e pessoal | Não |
| `commercial-attribution` | todos | comercial e pessoal | **Sim** (o texto exato vem no documento) |

Nenhum modelo é exclusivo nem transferível, e nenhum permite revender o arquivo tal como está. Um publisher pode ajustar qualquer campo por item.

### Mídia gerada por IA

Os serviços geradores (como `music-generator`) também entregam licença, e ela diz a verdade sobre o que é: uso comercial, **não exclusivo e não único** (o provedor pode gerar algo igual ou parecido para outra pessoa). Se um arquivo carrega marca d'água de procedência, a licença indica isso nas notas.

## Como verificar uma licença

1. Abra `https://app.kiba.tools/verify/<id>` (o `<id>` começa com `lic_` e vem na resposta). Você verá se o documento confere com a sua impressão digital, se o pagamento existe na Stellar e carrega essa impressão digital, e se a licença não foi revogada.
2. Sem confiar na Kiba: baixe o documento, calcule o seu SHA-256, abra a transação no explorador da Stellar e compare o quarto argumento de `pay` (`reference`) com os primeiros 8 bytes do hash lidos como um inteiro. Compare também o SHA-256 do arquivo que você tem com `asset.sha256`.

## Reembolsos e revogação

Se o serviço falhar, a chamada é reembolsada ao seu saldo e nenhuma licença é emitida. Se uma compra for reembolsada ou um publisher retirar um arquivo após uma reclamação de direitos, a Kiba marca a licença como **revogada** e a verificação dirá isso. A transação não muda. As licenças anteriores de outros compradores não são afetadas.

## Para publishers: como declarar a licença

Duas maneiras, ambas com o SDK:

**Um serviço que gera ou entrega arquivos.** Declare os termos padrão em `license` e devolva em cada resposta um bloco `license` com o hash do arquivo:

```ts
const agent = new AgentProvider({
  service: 'meu-gerador',
  pricePerCall: 0.05,
  license: { name: 'commercial', notes: 'Gerado com IA; não exclusivo.' },
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

Cada item é cobrado pelo seu `price_usd`; os que não têm, por `pricePerCall`.

A busca e a ficha de cada item são públicas e gratuitas (`GET /catalog/search?q=…`); a Kiba as usa para a busca federada `search_media`. Comprar é uma chamada paga com `{ assetId }`. A Kiba escreve o documento do comprador com o hash e os termos que você declarou, e o pagamento carrega a sua impressão digital.

**Um catálogo que você já tem na sua própria API.** Se a sua empresa já tem o catálogo atrás de uma API HTTP, não o migre: use `HttpCatalogSource`. Você informa a URL base da sua API, os cabeçalhos com a sua chave e uma função `map` que traduz cada registro da sua API para um item da Kiba:

```ts
import { HttpCatalogSource, MediaCatalogProvider } from 'kiba-sdk';

interface ItemDaMinhaApi { sku: string; name: string; price_cents: number; thumbnail_url?: string }

const source = new HttpCatalogSource<ItemDaMinhaApi>({
  baseUrl: 'https://api.minhaempresa.com/v1',
  headers: { Authorization: `Bearer ${process.env.EMPRESA_API_KEY}` },
  listPath: 'items', // responde um array ou { items | data | results: [] }
  map: (raw) => ({
    id: raw.sku,
    title: raw.name,
    type: 'image',
    priceUsd: raw.price_cents / 100,
    previewUrl: raw.thumbnail_url,
    downloadPath: `items/${raw.sku}/download-link`, // sua API responde { url, sha256?, bytes? }
  }),
  publicBaseUrl: PUBLIC_ENDPOINT,
});
const agent = new MediaCatalogProvider({ service: 'fotos-da-minha-empresa', pricePerCall: 0.05, source, license: { name: 'commercial' }, /* ... */ });
```

- **Cache.** O catálogo é carregado na primeira vez que é usado e recarregado em segundo plano a cada 5 minutos (`refreshMs`). Se a sua API falhar ao recarregar, a última cópia boa continua sendo servida. A busca é feita em memória, sem chamar a sua API.
- **Link novo em cada compra.** Com `downloadPath`, o link é pedido à sua API no momento da compra, então seus links assinados de curta duração funcionam. Se os seus links não expiram, devolva `downloadUrl` em `map` e ele é entregue como está.
- **Hash.** Se a sua API não fornece o `sha256` do arquivo, ele é baixado uma vez para calculá-lo e fica guardado em memória. `source.prehash()` o calcula para todo o catálogo na inicialização.
- **Sua chave não sai da sua API.** Os `headers` só são enviados à origem de `baseUrl`, nunca a outros domínios que apareçam nas suas respostas (por exemplo, o CDN de download).
- **Paginação própria.** Se a sua API pagina, passe `fetchItems: async (api) => …` em vez de `listPath` e percorra as páginas com `api.getJson(caminho, query)`. Um registro que `map` não consegue traduzir é omitido com um aviso; não derruba o catálogo.

Para outras origens (S3, seu próprio banco de dados), implemente a interface `CatalogSource` (quatro funções). A Kiba nunca se conecta ao seu banco de dados.

Ao publicar você declara que detém os direitos do que vende e aceita que a Kiba revogue licenças diante de uma reclamação fundamentada.
