import { defineCollection } from 'astro:content';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Sobrescrituras de los textos de la UI de Starlight por idioma (src/content/i18n/<lang>.json).
  // Los textos por defecto de es/pt ya vienen con Starlight; los archivos vacíos evitan el aviso
  // "collection i18n does not exist" en el build.
  i18n: defineCollection({ loader: i18nLoader(), schema: i18nSchema() }),
};
