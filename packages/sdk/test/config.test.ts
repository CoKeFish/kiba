import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Networks } from '@stellar/stellar-sdk';
import { resolveChainConfig, NETWORK_PRESETS } from '../src/config';
import { ConfigError } from '../src/errors';

// Empty env so tests are hermetic (no leakage from the host environment).
const NO_ENV = {} as Record<string, string | undefined>;

test('defaults to testnet preset when nothing is provided', () => {
  const c = resolveChainConfig({}, NO_ENV);
  assert.equal(c.network, 'testnet');
  assert.equal(c.rpcUrl, NETWORK_PRESETS.testnet.rpcUrl);
  assert.equal(c.networkPassphrase, Networks.TESTNET);
  assert.equal(c.friendbotUrl, NETWORK_PRESETS.testnet.friendbotUrl);
  assert.equal(c.asset, 'USDC');
  assert.equal(c.assetIssuer, NETWORK_PRESETS.testnet.usdcIssuer);
  assert.equal(c.contractId, null);
});

test('mainnet preset has no friendbot and uses the public passphrase', () => {
  const c = resolveChainConfig({ network: 'mainnet' }, NO_ENV);
  assert.equal(c.network, 'mainnet');
  assert.equal(c.networkPassphrase, Networks.PUBLIC);
  assert.equal(c.friendbotUrl, undefined);
  assert.equal(c.rpcUrl, NETWORK_PRESETS.mainnet.rpcUrl);
  assert.equal(c.assetIssuer, NETWORK_PRESETS.mainnet.usdcIssuer);
});

test('explicit options win over env which wins over preset', () => {
  const env = { STELLAR_RPC_URL: 'https://env-rpc', STELLAR_CONTRACT_ID: 'CENV' };
  // option overrides env
  const a = resolveChainConfig({ rpcUrl: 'https://opt-rpc' }, env);
  assert.equal(a.rpcUrl, 'https://opt-rpc');
  assert.equal(a.contractId, 'CENV'); // from env
  // env overrides preset
  const b = resolveChainConfig({}, env);
  assert.equal(b.rpcUrl, 'https://env-rpc');
});

test('two instances with different config coexist (no shared module state)', () => {
  const testnet = resolveChainConfig({ network: 'testnet', contractId: 'CTEST' }, NO_ENV);
  const mainnet = resolveChainConfig({ network: 'mainnet', contractId: 'CMAIN' }, NO_ENV);
  assert.equal(testnet.networkPassphrase, Networks.TESTNET);
  assert.equal(mainnet.networkPassphrase, Networks.PUBLIC);
  assert.equal(testnet.contractId, 'CTEST');
  assert.equal(mainnet.contractId, 'CMAIN');
});

test('friendbutUrl: null disables friendbot explicitly', () => {
  const c = resolveChainConfig({ network: 'testnet', friendbotUrl: null }, NO_ENV);
  assert.equal(c.friendbotUrl, undefined);
});

test('Trustless Work active without platformAddress throws ConfigError (#20)', () => {
  assert.throws(
    () => resolveChainConfig({ trustlessWork: { apiKey: 'k' } }, NO_ENV),
    (err: unknown) => err instanceof ConfigError && /platformAddress/.test((err as Error).message),
  );
});

test('Trustless Work resolves api/fee/trustline from options', () => {
  const c = resolveChainConfig(
    {
      trustlessWork: {
        apiKey: 'k',
        platformAddress: 'GPLATFORM',
        fee: 7,
        apiUrl: 'https://tw.example',
      },
    },
    NO_ENV,
  );
  assert.ok(c.tw);
  assert.equal(c.tw!.apiKey, 'k');
  assert.equal(c.tw!.platformAddress, 'GPLATFORM');
  assert.equal(c.tw!.platformFee, 7);
  assert.equal(c.tw!.apiUrl, 'https://tw.example');
  assert.equal(c.tw!.trustline.symbol, 'USDC');
});

test('Trustless Work platformAddress can come from env', () => {
  const c = resolveChainConfig(
    { trustlessWork: { apiKey: 'k' } },
    { TRUSTLESS_WORK_PLATFORM_ADDRESS: 'GENVPLAT' },
  );
  assert.ok(c.tw);
  assert.equal(c.tw!.platformAddress, 'GENVPLAT');
});
