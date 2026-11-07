/**
 * Filtro anti-SSRF para las URLs que el gateway visita por cuenta de un usuario o de un
 * servicio: el proxy x402 (x402.ts) y la copia de archivos de resultados (files.ts).
 *
 * Solo https (http si X402_ALLOW_HTTP=1, para desarrollo), sin credenciales embebidas y fuera
 * de redes privadas (X402_ALLOW_PRIVATE=1 lo abre, para desarrollo y tests). El host se
 * resuelve por DNS y se rechaza si CUALQUIERA de sus direcciones es privada.
 */
import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const low = ip.toLowerCase();
  return low === '::' || low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

/** Valida la URL: https, sin credenciales embebidas y fuera de redes privadas (anti-SSRF). */
export async function assertAllowedUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`url inválida: ${raw}`);
  }
  const allowHttp = process.env.X402_ALLOW_HTTP === '1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowHttp)) {
    throw new Error('la URL debe ser https');
  }
  if (u.username || u.password) throw new Error('la URL no puede llevar credenciales');
  if (process.env.X402_ALLOW_PRIVATE !== '1') {
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
      throw new Error('la URL apunta a una red privada');
    }
    const addrs = isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (addrs.length === 0) throw new Error(`no se pudo resolver ${host}`);
    if (addrs.some(isPrivateAddress)) throw new Error('la URL apunta a una red privada');
  }
  return u;
}
