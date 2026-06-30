/**
 * World Clock — agente DEMO con resultados REALES (no mock).
 *
 * Dice la hora actual en cualquier ciudad/huso horario y encuentra la mejor
 * franja para una reunión entre varias zonas. Usa Intl con la base IANA de
 * Node (full-icu en node:20), así que la hora es real y sin API externa.
 *
 * Ejemplos de uso vía call_agent:
 *   { "zone": "Tokyo" }
 *   { "zones": ["New York", "London", "Bogotá"] }
 *   { "meeting": ["San Francisco", "London", "India"], "workStart": 9, "workEnd": 18 }
 */
import { AgentProvider, loadKeypairFromEnvOrFile } from '@kiba/sdk';

const KEYPAIR_PATH = process.env.KEYPAIR_PATH || '/app/data/world-clock.json';
const wallet = loadKeypairFromEnvOrFile('AGENT_WALLET_SECRET', KEYPAIR_PATH);

// Pricing dinámico: cobra por zona/huso consultado (floor cubre 1).
const PRICE_FLOOR_USDC = 0.0005;
const PRICE_PER_ZONE_USDC = 0.0005;

// Alias amistosos → IANA. El usuario puede mandar "Tokyo", "NYC", "bogota"
// o un IANA directo ("Asia/Tokyo"); cualquier IANA válido funciona igual.
const ALIASES: Record<string, string> = {
  utc: 'UTC',
  gmt: 'UTC',
  tokyo: 'Asia/Tokyo',
  japan: 'Asia/Tokyo',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  ny: 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  chicago: 'America/Chicago',
  denver: 'America/Denver',
  toronto: 'America/Toronto',
  london: 'Europe/London',
  uk: 'Europe/London',
  dublin: 'Europe/Dublin',
  lisbon: 'Europe/Lisbon',
  paris: 'Europe/Paris',
  madrid: 'Europe/Madrid',
  spain: 'Europe/Madrid',
  barcelona: 'Europe/Madrid',
  berlin: 'Europe/Berlin',
  amsterdam: 'Europe/Amsterdam',
  rome: 'Europe/Rome',
  italy: 'Europe/Rome',
  moscow: 'Europe/Moscow',
  istanbul: 'Europe/Istanbul',
  dubai: 'Asia/Dubai',
  india: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  china: 'Asia/Shanghai',
  seoul: 'Asia/Seoul',
  korea: 'Asia/Seoul',
  jakarta: 'Asia/Jakarta',
  bangkok: 'Asia/Bangkok',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  auckland: 'Pacific/Auckland',
  bogota: 'America/Bogota',
  'bogotá': 'America/Bogota',
  colombia: 'America/Bogota',
  lima: 'America/Lima',
  santiago: 'America/Santiago',
  'mexico city': 'America/Mexico_City',
  mexico: 'America/Mexico_City',
  cdmx: 'America/Mexico_City',
  'sao paulo': 'America/Sao_Paulo',
  'são paulo': 'America/Sao_Paulo',
  brazil: 'America/Sao_Paulo',
  'buenos aires': 'America/Argentina/Buenos_Aires',
  argentina: 'America/Argentina/Buenos_Aires',
};

// Husos demo cuando la petición no especifica ninguno.
const DEFAULT_ZONES = ['Los Angeles', 'New York', 'Bogotá', 'London', 'Tokyo'];

interface ClockRequest {
  zone?: string;
  zones?: string[];
  /** Husos a reunir: devuelve la mejor franja de solape de horario laboral. */
  meeting?: string[];
  /** Hora local de inicio de jornada (0-24, default 9). */
  workStart?: number;
  /** Hora local de fin de jornada (0-24, default 18). */
  workEnd?: number;
}

interface ZoneTime {
  query: string;
  zone: string;
  time: string;
  date: string;
  utcOffset: string;
  partOfDay: string;
  icon: string;
}

interface MeetingPlan {
  zones: string[];
  workWindow: string;
  best: Array<{ utc: string; fitsAll: boolean; local: Record<string, string> }>;
  note: string;
}

interface ClockResponse {
  now: ZoneTime[];
  unresolved: string[];
  meeting?: MeetingPlan;
}

function resolveZone(input: string): string | null {
  const raw = input.trim();
  const alias = ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  // ¿IANA válido directo? Intl lanza RangeError si la zona no existe.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return null;
  }
}

/** Offset real de la zona vs UTC, en minutos (maneja DST y husos :30/:45). */
function offsetMinutes(zone: string, now: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(now)) if (p.type !== 'literal') m[p.type] = p.value;
  let hour = Number(m.hour);
  if (hour === 24) hour = 0;
  const asIfUTC = Date.UTC(
    Number(m.year),
    Number(m.month) - 1,
    Number(m.day),
    hour,
    Number(m.minute),
    Number(m.second),
  );
  return Math.round((asIfUTC - now.getTime()) / 60000);
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function partOfDay(hour: number): { name: string; icon: string } {
  if (hour < 6) return { name: 'night', icon: '🌙' };
  if (hour < 12) return { name: 'morning', icon: '🌅' };
  if (hour < 18) return { name: 'afternoon', icon: '☀️' };
  if (hour < 21) return { name: 'evening', icon: '🌆' };
  return { name: 'night', icon: '🌙' };
}

function describeZone(query: string, zone: string, now: Date): ZoneTime {
  const disp = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of disp.formatToParts(now)) if (p.type !== 'literal') m[p.type] = p.value;
  let hh = Number(m.hour);
  if (hh === 24) hh = 0;
  const part = partOfDay(hh);
  return {
    query,
    zone,
    time: `${String(hh).padStart(2, '0')}:${m.minute}`,
    date: `${m.weekday}, ${m.month} ${m.day}`,
    utcOffset: fmtOffset(offsetMinutes(zone, now)),
    partOfDay: part.name,
    icon: part.icon,
  };
}

function clampHour(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(24, Math.max(0, Math.floor(value)));
}

function planMeeting(zones: string[], now: Date, workStart: number, workEnd: number): MeetingPlan {
  const offs = zones.map((z) => offsetMinutes(z, now));
  let best: Array<{ hour: number; count: number; local: Record<string, string> }> = [];
  let max = 0;
  for (let h = 0; h < 24; h++) {
    const local: Record<string, string> = {};
    let count = 0;
    zones.forEach((z, i) => {
      const tot = (((h * 60 + offs[i]) % 1440) + 1440) % 1440;
      const lh = Math.floor(tot / 60);
      const lm = tot % 60;
      local[z] = `${String(lh).padStart(2, '0')}:${String(lm).padStart(2, '0')}`;
      const decimal = tot / 60;
      if (decimal >= workStart && decimal < workEnd) count++;
    });
    if (count > max) {
      max = count;
      best = [{ hour: h, count, local }];
    } else if (count === max) {
      best.push({ hour: h, count, local });
    }
  }
  const top = best.slice(0, 3);
  return {
    zones,
    workWindow: `${String(workStart).padStart(2, '0')}:00–${String(workEnd).padStart(2, '0')}:00 local`,
    best: top.map((b) => ({
      utc: `${String(b.hour).padStart(2, '0')}:00 UTC`,
      fitsAll: b.count === zones.length,
      local: b.local,
    })),
    note:
      max === zones.length
        ? `Hay ${top.length} franja(s) donde las ${zones.length} zonas están en horario laboral.`
        : `Ninguna franja sirve para todos; la mejor cubre ${max}/${zones.length} zonas.`,
  };
}

const agent = new AgentProvider({
  wallet,
  service: 'world-clock',
  pricePerCall: PRICE_FLOOR_USDC,
  pricingNote: `${PRICE_PER_ZONE_USDC} USDC por zona consultada (floor ${PRICE_FLOOR_USDC} USDC)`,
  priceFn: (req: unknown) => {
    const r = req as ClockRequest;
    const zones = (r?.zones?.length ?? (r?.zone ? 1 : 0)) + (r?.meeting?.length ?? 0);
    return Math.max(1, zones) * PRICE_PER_ZONE_USDC;
  },
  description:
    'Current time in any city or timezone, plus the best meeting slot across remote teams. Real time data (no mock), accepts city names or IANA zones.',
  endpoint: process.env.PUBLIC_ENDPOINT || 'http://demo-agents:5007',
  // Acepta llamadas firmadas por la plataforma (gateway), verificando con la clave PÚBLICA publicada.
  platform: process.env.KIBA_PLATFORM_PUBLIC_KEY
    ? { publicKey: process.env.KIBA_PLATFORM_PUBLIC_KEY }
    : undefined,
});

agent.serve<ClockRequest, ClockResponse>(async (req) => {
  const now = new Date();
  const queries =
    Array.isArray(req.zones) && req.zones.length > 0
      ? req.zones
      : req.zone
        ? [req.zone]
        : DEFAULT_ZONES;

  const nowTimes: ZoneTime[] = [];
  const unresolved: string[] = [];
  for (const q of queries) {
    const zone = resolveZone(q);
    if (zone) nowTimes.push(describeZone(q, zone, now));
    else unresolved.push(q);
  }

  let meeting: MeetingPlan | undefined;
  if (Array.isArray(req.meeting) && req.meeting.length > 0) {
    const resolved = req.meeting
      .map((q) => resolveZone(q))
      .filter((z): z is string => z !== null);
    if (resolved.length > 0) {
      meeting = planMeeting(
        resolved,
        now,
        clampHour(req.workStart, 9),
        clampHour(req.workEnd, 18),
      );
    }
  }

  return { now: nowTimes, unresolved, ...(meeting ? { meeting } : {}) };
});

(async () => {
  try {
    await agent.bootstrap();
  } catch (err) {
    console.error('[world-clock] bootstrap failed:', (err as Error).message);
    console.error('[world-clock] Continuing without on-chain registration. Make sure STELLAR_CONTRACT_ID is set in .env.');
  }
  await agent.listen(Number(process.env.PORT) || 5007);
})().catch((err) => {
  console.error('[world-clock] failed to start:', err);
  process.exit(1);
});
