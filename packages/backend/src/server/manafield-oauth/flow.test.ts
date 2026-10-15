/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it } from 'vitest';
import { createBrowserProof, isSameOriginMutation, safeRedirectTarget } from './flow.js';

describe('Noctemblith Manafield browser correlation', () => {
 it('requires an exact local origin or same-origin Fetch Metadata', () => {
  const url = 'https://noctemblith-dev.manafield.studio';
  expect(isSameOriginMutation(url, undefined, url)).toBe(true);
  expect(isSameOriginMutation('null', 'same-origin', url)).toBe(true);
  expect(isSameOriginMutation(undefined, 'same-origin', url)).toBe(true);
  for (const [origin, fetchSite] of [
   ['https://attacker.test', 'same-origin'], ['null', 'cross-site'],
   ['null', 'same-site'], ['null', undefined], [undefined, undefined],
   [url, 'cross-site'], [url, 'same-site'], ['http://noctemblith-dev.manafield.studio', 'same-origin'],
  ] as Array<[string | undefined, string | undefined]>) {
   expect(isSameOriginMutation(origin, fetchSite, url)).toBe(false);
  }
 });
 it('generates unpredictable browser proofs', () => {
  const first = createBrowserProof();
  const second = createBrowserProof();
  expect(first).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(first).not.toBe(second);
 });
 it('never redirects to caller supplied URLs', () => {
  expect(safeRedirectTarget('link', 'linked')).toBe('/settings/connect?manafield=linked');
  expect(safeRedirectTarget('login', 'unlinked')).toBe('/auth/manafield/finish?status=unlinked');
  expect(safeRedirectTarget('login', 'signup')).toBe('/auth/manafield/finish?status=signup');
  expect(safeRedirectTarget('link', 'https://evil.example')).toBe('/settings/connect?manafield=failed');
  expect(safeRedirectTarget('login', '//evil.example')).toBe('/auth/manafield/finish?status=failed');
 });
});
