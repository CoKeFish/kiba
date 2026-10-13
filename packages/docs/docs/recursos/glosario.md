---
title: "Glosario"
description: "Términos que aparecen en la documentación de Kiba."
---

# Glosario

| Término | Significado |
|---|---|
| **Servicio** | Cualquier agente de IA, API, indexador o herramienta que responde peticiones por un precio y está registrado en Kiba. |
| **Publisher** | Quien construye y publica un servicio y cobra por llamada. |
| **Asistente** | Claude, ChatGPT, Cursor, Claude Code u otro cliente MCP que busca y llama servicios por el usuario. |
| **MCP (Model Context Protocol)** | Protocolo abierto de Anthropic para que un asistente use herramientas externas. |
| **x402** | Protocolo de pago nativo de HTTP (introducido por Coinbase): `402 Payment Required` con una cotización, pago y reintento con prueba. |
| **Soroban** | Plataforma de contratos inteligentes de Stellar (Rust). |
| **Contrato de registro** | Contrato Soroban donde cada servicio queda registrado on-chain. |
| **USDC** | Stablecoin en dólares (Circle), activo de liquidación de Kiba. |
| **Trustline** | Opt-in de una cuenta Stellar para poder tener un activo distinto de XLM. |
| **Unidades base / stroops** | Menor unidad del activo de liquidación: 1 USDC = 10.000.000. |
| **Créditos** | Saldo en USD en el libro del gateway que gasta un asistente. |
| **Kibix** | Unidad de display de los créditos en el dashboard: 10.000 Kibix = 1 USD. |
| **Wallet** | Cuenta Stellar del usuario (on-chain), independiente de los créditos. |
| **Tesorería (treasury)** | Cuenta de la plataforma que firma liquidaciones por crédito y recibe la comisión. |
| **Llamada firmada por la plataforma** | Llamada rápida, fuera de cadena, que el servicio autentica con la clave pública de la plataforma. |
| **Escrow x402 (directo)** | Pago sin confianza: el cliente fondea un escrow que nombra al servicio como receptor. |
| **Liquidación por lotes** | Pago periódico de las ganancias acumuladas de un publisher. |
| **Bootstrap** | Paso de `AgentProvider`/`AgentClient` que fondea la cuenta en testnet, configura la trustline y (provider) registra el servicio. |
| **Friendbot** | Faucet de testnet que fondea cuentas nuevas con XLM de prueba. |
| **FTS5 / BM25** | Búsqueda de texto completo de SQLite y su ranking por relevancia. |
| **Embedding** | Vector (aquí 384 dimensiones) que representa el significado de un texto para la búsqueda semántica. |
| **PKCE** | Extensión de OAuth que evita que se robe el código de autorización en clientes públicos. |
| **Anchor (Stellar)** | Entidad que convierte entre dinero local y activos en Stellar (rampas fiat). |
| **Bre-B / PSE** | Rieles de pago colombianos (llaves instantáneas / débito bancario en línea). |
