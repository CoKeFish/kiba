---
title: "Documentación para asistentes de IA"
sidebar_label: "Docs para asistentes de IA"
description: "Versiones en texto plano de estas docs para que un asistente las lea directamente."
---

# Documentación para asistentes de IA

El sitio publica versiones en texto plano de la documentación para que un asistente pueda leerla directamente, sin navegar el HTML:

| Archivo | Contenido |
|---|---|
| [`/llms.txt`](pathname:///llms.txt) | Índice: título, descripción y enlace de cada página |
| [`/llms-full.txt`](pathname:///llms-full.txt) | Toda la documentación concatenada en un solo archivo |

Se generan en cada build a partir de las mismas páginas que lees aquí, así que nunca se desfasan.

:::tip[Cómo usarlos]
Pega la URL de `llms-full.txt` en tu asistente (o adjunta el archivo) y pregúntale sobre Kiba. Para preguntas puntuales, `llms.txt` le basta para encontrar la página adecuada.
:::

:::note
Los archivos solo existen en el sitio compilado (`npm run build`). En el servidor de desarrollo (`npm start`) devuelven 404.
:::
