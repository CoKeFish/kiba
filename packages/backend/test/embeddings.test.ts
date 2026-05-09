import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSim } from '../src/embeddings';

test('cosineSim de vectores idénticos = 1', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([1, 2, 3]);
  assert.ok(Math.abs(cosineSim(a, b) - 1) < 1e-6);
});

test('cosineSim de vectores ortogonales = 0', () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([0, 1]);
  assert.ok(Math.abs(cosineSim(a, b)) < 1e-6);
});

test('cosineSim de vectores opuestos = -1', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([-1, -2, -3]);
  assert.ok(Math.abs(cosineSim(a, b) + 1) < 1e-6);
});

test('cosineSim de vector con cero = 0', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([0, 0, 0]);
  assert.equal(cosineSim(a, b), 0);
});

test('cosineSim escala invariante (longitud no importa)', () => {
  const a = new Float32Array([1, 2, 3]);
  const b = new Float32Array([2, 4, 6]); // mismo dirección, distinta magnitud
  assert.ok(Math.abs(cosineSim(a, b) - 1) < 1e-6);
});

test('cosineSim throws si dimensiones distintas', () => {
  const a = new Float32Array([1, 2]);
  const b = new Float32Array([1, 2, 3]);
  assert.throws(() => cosineSim(a, b), /dimensiones/);
});
