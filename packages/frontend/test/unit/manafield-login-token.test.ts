/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it } from 'vitest';
import { isValidManafieldLoginToken } from '../../src/utility/manafield-login-token.js';

describe('Manafield OAuth login response token formats', () => {
 it('accepts independent revocable device session tokens', () => {
  expect(isValidManafieldLoginToken('mfs1_' + 'a'.repeat(43))).toBe(true);
  expect(isValidManafieldLoginToken('mfs1_' + 'Z0_-'.repeat(10) + 'abc')).toBe(true);
 });
 it('preserves support for legacy 16-character login responses', () => {
  expect(isValidManafieldLoginToken('1234567890abcdef')).toBe(true);
 });
 it('rejects malformed, missing, and unexpected response tokens', () => {
  for (const token of [null, undefined, 0, {}, '', 'x'.repeat(15),
   'mfs1_' + 'a'.repeat(42), 'mfs1_' + 'a'.repeat(44),
   'mfs1_' + 'a'.repeat(42) + '=', 'anotherprefix_' + 'a'.repeat(43)]) {
   expect(isValidManafieldLoginToken(token)).toBe(false);
  }
 });
});
