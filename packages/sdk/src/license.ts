/**
 * Licencias de medios: lo que un servicio declara sobre el archivo que entrega.
 *
 * Un servicio que vende imágenes, música, modelos 3D o cualquier archivo devuelve, junto al
 * resultado, un bloque `license` con el hash del archivo y los términos. El gateway de Kiba
 * escribe con él un documento de licencia (comprador, vendedor, archivo, términos, precio) y el
 * pago en Stellar de esa llamada lleva la huella del documento: la transacción es la prueba.
 *
 * Los usos permitidos (`usage`) y quién puede usarlo (`user`) son palabras del sector de medios,
 * pensadas para que las lea una persona: "advertising", "social-media", "commercial"…
 */
import { createHash } from 'node:crypto';

/** Usos permitidos de un archivo (vocabulario del sector de medios). */
export const LICENSE_USAGES = [
  'advertising', // anuncios pagados: digital, exterior, televisión
  'social-media', // publicaciones y vídeos en redes sociales
  'broadcast', // televisión, radio, streaming
  'print', // impresión: revistas, carteles, libros
  'merchandise', // productos a la venta con el archivo impreso
  'editorial', // noticias, blogs, documentales
  'web', // sitios web y apps
] as const;
export type LicenseUsage = (typeof LICENSE_USAGES)[number];

/**
 * Usos propios de las fuentes tipográficas. Una fuente no se "publica" como una foto: se instala
 * para diseñar o se incrusta en un sitio, una app o un libro, y cada cosa se licencia aparte.
 */
export const FONT_LICENSE_USAGES = [
  'desktop', // instalarla en computadores para diseñar (lo que se produce: impresos, imágenes, logos)
  'webfont', // incrustarla en sitios web con @font-face
  'app', // incrustarla dentro de una app móvil o de escritorio
  'ebook', // incrustarla en libros y documentos electrónicos
] as const;
export type FontLicenseUsage = (typeof FONT_LICENSE_USAGES)[number];

/** Lo que se hace con lo diseñado en escritorio (impresos, imágenes): sirve a cualquier licencia de fuente. */
const FONT_OUTPUT_USAGES = ['print', 'advertising', 'social-media', 'merchandise', 'editorial', 'broadcast'];

/** Quién puede usar el archivo. */
export const LICENSE_USERS = ['commercial', 'personal', 'education', 'non-commercial', 'government'] as const;
export type LicenseUser = (typeof LICENSE_USERS)[number];

/** Términos de una licencia. Todos los campos son opcionales: lo que falte se completa con la
 *  plantilla del servicio (`AgentConfig.license`) y, en último término, con
 *  `LICENSE_TEMPLATES.commercial`. */
export interface LicenseTerms {
  /** Nombre de la plantilla: 'personal' | 'commercial' | 'commercial-attribution' | otro. */
  name?: string;
  /** Usos permitidos: ver {@link LICENSE_USAGES}. */
  usage?: string[];
  /** Quién puede usarlo: ver {@link LICENSE_USERS}. */
  user?: string[];
  /** Territorios ISO 3166-1 alpha-2, o ['*'] para todo el mundo. */
  geo?: string[];
  /** ¿Exige atribución al autor? */
  attribution?: boolean;
  /** ¿Licencia exclusiva? (casi siempre false) */
  exclusive?: boolean;
  /** ¿Puede cederse a un tercero? (casi siempre false) */
  transferable?: boolean;
  /** 'perpetual' o una duración ISO 8601 (p.ej. 'P1Y'). */
  duration?: string;
  /** URL del texto completo de los términos. */
  termsUrl?: string;
  /** Nota en lenguaje normal (p.ej. "generado con IA; el proveedor puede generar algo similar para otros"). */
  notes?: string;
}

/** Bloque `license` que un servicio devuelve junto al resultado. */
export interface LicenseGrant {
  /** SHA-256 (hex, 64 caracteres) del archivo entregado. Obligatorio: es lo que identifica el activo. */
  assetSha256: string;
  /** Identificador del ítem en el catálogo del publisher, si existe. */
  assetId?: string;
  title?: string;
  filename?: string;
  mimeType?: string;
  bytes?: number;
  /** URL de descarga (puede caducar; el hash es lo que perdura). */
  assetUrl?: string;
  /** Texto de atribución exacto cuando `terms.attribution` es true. */
  attributionText?: string;
  /** Términos de ESTE activo; se completan con la plantilla del servicio. */
  terms?: LicenseTerms;
}

export const LICENSE_TEMPLATES: Record<string, LicenseTerms> = {
  personal: {
    name: 'personal',
    usage: ['web', 'social-media', 'print'],
    user: ['personal', 'non-commercial', 'education'],
    geo: ['*'],
    attribution: false,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
  },
  commercial: {
    name: 'commercial',
    usage: [...LICENSE_USAGES],
    user: ['commercial', 'personal', 'education', 'non-commercial'],
    geo: ['*'],
    attribution: false,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
  },
  'commercial-attribution': {
    name: 'commercial-attribution',
    usage: [...LICENSE_USAGES],
    user: ['commercial', 'personal', 'education', 'non-commercial'],
    geo: ['*'],
    attribution: true,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
  },
  // Fuentes: el número de equipos o de visitas va en `notes` de cada ítem.
  'font-desktop': {
    name: 'font-desktop',
    usage: ['desktop', ...FONT_OUTPUT_USAGES],
    user: ['commercial', 'personal', 'education', 'non-commercial'],
    geo: ['*'],
    attribution: false,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
  },
  'font-web': {
    name: 'font-web',
    usage: ['desktop', 'webfont', ...FONT_OUTPUT_USAGES],
    user: ['commercial', 'personal', 'education', 'non-commercial'],
    geo: ['*'],
    attribution: false,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
  },
  'font-full': {
    name: 'font-full',
    usage: [...FONT_LICENSE_USAGES, ...FONT_OUTPUT_USAGES],
    user: ['commercial', 'personal', 'education', 'non-commercial'],
    geo: ['*'],
    attribution: false,
    exclusive: false,
    transferable: false,
    duration: 'perpetual',
  },
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** SHA-256 en hex de un buffer o texto (para `assetSha256`). */
export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Completa unos términos con una plantilla (los campos del activo mandan). */
export function mergeLicenseTerms(base: LicenseTerms | undefined, override: LicenseTerms | undefined): LicenseTerms {
  const template = LICENSE_TEMPLATES[override?.name ?? base?.name ?? 'commercial'] ?? LICENSE_TEMPLATES.commercial;
  return { ...template, ...(base ?? {}), ...(override ?? {}) };
}

/**
 * Si el resultado de un handler trae `license`, lo valida y completa sus términos con la
 * plantilla del servicio. Si no trae, devuelve el resultado tal cual. Un `assetSha256` inválido
 * se descarta (con aviso) en vez de romper la respuesta: el usuario ya pagó por el contenido.
 */
export function normalizeLicense(result: unknown, serviceTerms?: LicenseTerms): unknown {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  const raw = r.license;
  if (typeof raw !== 'object' || raw === null) return result;
  const grant = raw as Partial<LicenseGrant>;
  const sha = typeof grant.assetSha256 === 'string' ? grant.assetSha256.toLowerCase() : '';
  if (!SHA256_HEX.test(sha)) {
    console.warn('[kiba-sdk] license ignored: assetSha256 must be 64 hex chars');
    const { license: _drop, ...rest } = r;
    return rest;
  }
  const license: LicenseGrant = {
    ...grant,
    assetSha256: sha,
    terms: mergeLicenseTerms(serviceTerms, grant.terms),
  };
  return { ...r, license };
}
