---
title: "Documentation for AI assistants"
sidebar_label: "Docs for AI assistants"
description: "Plain-text versions of these docs so an assistant can read them directly."
---

# Documentation for AI assistants

The site publishes plain-text versions of the documentation so an assistant can read it directly, without browsing the HTML:

| File | Contents |
|---|---|
| [`/en/llms.txt`](pathname:///en/llms.txt) | Index: title, description and link for every page |
| [`/en/llms-full.txt`](pathname:///en/llms-full.txt) | The whole documentation concatenated into a single file |

They are generated on every build from the same pages you are reading, so they never drift.

:::tip[How to use them]
Paste the `llms-full.txt` URL into your assistant (or attach the file) and ask it about Kiba. For specific questions, `llms.txt` is enough for it to find the right page.
:::

:::note
The files only exist on the built site (`npm run build`). On the development server (`npm start`) they return 404.
:::
