/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManafieldSessionService, isManafieldBrowserSessionToken } from './ManafieldSessionService.js';

function fixture() {
 const records = new Map<string, string>();
 const redis = {
  set: vi.fn(async (key: string, value: string, ex: string, ttl: number, nx: string) => {
   expect([ex, ttl, nx]).toEqual(['EX', 60 * 60 * 24 * 30, 'NX']);
   if (records.has(key)) return null;
   records.set(key, value);
   return 'OK';
  }),
  get: vi.fn(async (key: string) => records.get(key) ?? null),
  del: vi.fn(async (key: string) => Number(records.delete(key))),
  exists: vi.fn(async (key: string) => Number(records.has(key))),
 };
 const users = new Map([
  ['user-a', { id: 'user-a', host: null, isDeleted: false, isSuspended: false }],
  ['user-b', { id: 'user-b', host: null, isDeleted: false, isSuspended: false }],
 ]);
 const repo = { findOneBy: vi.fn(async ({ id }: { id: string }) => users.get(id) ?? null) };
 const service = new ManafieldSessionService(redis as any, repo as any);
 return { service, redis, users, records, repo };
}

afterEach(() => vi.unstubAllEnvs());

describe('Independent Manafield browser sessions', () => {
 it('issues distinct high-entropy tokens without storing plaintext tokens', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const { service, records } = fixture();
  const a = await service.issue('user-a');
  const b = await service.issue('user-a');
  expect(isManafieldBrowserSessionToken(a)).toBe(true);
  expect(a).not.toBe(b);
  expect([...records.keys()].join(' ')).not.toContain(a);
  expect(await service.resolve(a)).toMatchObject({ id: 'user-a' });
  expect(await service.resolve(b)).toMatchObject({ id: 'user-a' });
 });
 it('releases exactly one browser session and leaves other users and devices intact', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const { service } = fixture();
  const laptop = await service.issue('user-a');
  const phone = await service.issue('user-a');
  const other = await service.issue('user-b');
  expect(await service.revoke(laptop)).toBe(true);
  expect(await service.isActive(laptop)).toBe(false);
  expect(await service.resolve(laptop)).toBeNull();
  expect(await service.isActive(phone)).toBe(true);
  expect(await service.resolve(phone)).toMatchObject({ id: 'user-a' });
  expect(await service.resolve(other)).toMatchObject({ id: 'user-b' });
  expect(await service.revoke(laptop)).toBe(false);
 });
 it('rejects malformed, expired, corrupt, suspended and deleted sessions', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const { service, records, users } = fixture();
  expect(await service.resolve('x'.repeat(16))).toBeNull();
  expect(await service.revoke('mfs1_bad')).toBe(false);
  const token = await service.issue('user-a');
  users.get('user-a')!.isSuspended = true;
  expect(await service.resolve(token)).toBeNull();
  users.get('user-a')!.isSuspended = false;
  users.get('user-a')!.isDeleted = true;
  expect(await service.resolve(token)).toBeNull();
  users.get('user-a')!.isDeleted = false;
  const key = [...records.keys()][0];
  records.set(key, '{bad');
  expect(await service.resolve(token)).toBeNull();
  records.clear();
  expect(await service.resolve(token)).toBeNull();
 });
 it('does not use central dependencies in standalone mode', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', '');
  const { service, redis } = fixture();
  expect(service.enabled).toBe(false);
  await expect(service.issue('user-a')).rejects.toThrow();
  expect(await service.resolve('mfs1_' + 'a'.repeat(43))).toBeNull();
  expect(await service.revoke('mfs1_' + 'a'.repeat(43))).toBe(false);
  expect(redis.get).not.toHaveBeenCalled();
 });
 it('fails closed when the session store is unavailable', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const { service, redis } = fixture();
  const token = await service.issue('user-a');
  redis.get.mockRejectedValueOnce(new Error('redis unavailable'));
  await expect(service.resolve(token)).rejects.toThrow('redis unavailable');
 });
});
