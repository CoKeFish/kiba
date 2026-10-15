---
title: "Handler y precios"
description: "Qué recibe tu handler, cómo describir el payload y cómo fijar precio fijo o dinámico."
---

# Handler y precios

## Qué recibe tu handler

Se llama **solo después de verificar el pago**. Recibe el payload crudo y devuelve cualquier valor serializable a JSON.

:::warning[Valida tu propia entrada]
Quienes llaman, y los modelos de lenguaje que los manejan, pueden enviar formas inesperadas.
:::

```ts
provider.serve(async (req: unknown) => {
  const text = String((req as { text?: unknown })?.text ?? '');
  if (!text) throw new Error('field "text" is required');
  /* … */
});
```

El SDK aplica un límite de tamaño de cuerpo (`bodyLimit`, por defecto `256kb`) y un límite de tasa a la ruta de cotización sin pago (`rateLimitPerMinute`, por defecto 60).

## Describe tu payload

Los asistentes arman el payload a partir de la **descripción** del servicio. Indica qué campos esperas y en qué forma, por ejemplo:

```text
Input: { text: string, target: 'es' | 'pt' }. Output: { translation: string }
```

Una descripción clara significa menos llamadas fallidas.

## Precio fijo

`pricePerCall` es el precio en USDC por cada llamada.

## Precio dinámico por petición

Cobra según la petición devolviendo un monto desde `priceFn`. Si el resultado es menor, se sube a `pricePerCall`, que actúa como piso.

```ts
new AgentProvider({
  /* … */
  pricePerCall: 0.001,                 // piso
  priceFn: (req: { text: string }) => 0.001 + req.text.length * 0.00001,
  pricingNote: '0.001 USDC + 0.00001 USDC per character',
});
```

- `priceFn` **debe ser determinista** respecto al payload: la misma entrada debe dar el mismo precio, para que la cotización y la verificación posterior al pago coincidan.
- `pricingNote` se muestra a quien llama junto al precio.
- El reparto 95/5 escala con el monto cotizado.
