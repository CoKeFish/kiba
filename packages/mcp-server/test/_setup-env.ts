/**
 * Test scaffolding para mcp-server.
 *
 * El módulo principal (src/index.ts) corre `server.connect(transport)` al
 * cargarse — eso intentaría hablar por stdio en el contexto de tests y
 * rompería el harness. Para evitar tocar la fuente, monkey-patcheamos
 * `Server.prototype.connect` ANTES de que se importe el módulo, capturando
 * la instancia para invocar sus handlers directamente.
 *
 * También seteamos `KIBA_TOKEN_PATH` a un archivo temporal con un
 * token válido pre-grabado, así los helpers de auth no abren el browser.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export const TEST_TMP_DIR = mkdtempSync(join(tmpdir(), 'mcp-test-'));
export const TEST_TOKEN_PATH = join(TEST_TMP_DIR, 'token.json');

// Pre-popular el token para evitar que el flow de OAuth (que abre browser)
// se dispare. La fecha de expiración es +1 hora.
const now = Math.floor(Date.now() / 1000);
writeFileSync(
  TEST_TOKEN_PATH,
  JSON.stringify({
    access_token: 'tok_test_dummy',
    expires_at: now + 3600,
    saved_at: now,
  }),
);
process.env.KIBA_TOKEN_PATH = TEST_TOKEN_PATH;
process.env.KIBA_URL = 'http://mock-gateway.test';
process.env.KIBA_CLIENT_NAME = 'test-mcp-client';

// Capturar la instancia de Server interceptando connect()
let _captured: unknown = null;
(Server.prototype as unknown as { connect: (t: unknown) => Promise<void> }).connect =
  async function (this: unknown, _t: unknown) {
    _captured = this;
  };

export function getCapturedServer(): {
  _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
} {
  if (!_captured) {
    throw new Error('Server no capturado — asegúrate de importar src/index.ts después de _setup-env');
  }
  return _captured as { _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>> };
}
