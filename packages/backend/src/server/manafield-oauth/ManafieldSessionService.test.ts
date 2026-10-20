/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManafieldSessionService, isManafieldBrowserSessionToken } from './ManafieldSessionService.js';

function fixture() {
 const records = new Map<string, string>();
 const guardSets = new Map<string, Set<string>>();
 const scans = new Map<string, string[]>();

 const redis = {
  set: vi.fn(async (key: string, value: string, ex: string, ttl: number, nx?: string) => {
   expect([ex, ttl]).toEqual(['EX', 60 * 60 * 24 * 30]);
   if (key.startsWith('noctemblith:manafield:browser-session:')) expect(nx).toBe('NX');
   if (nx === 'NX' && records.has(key)) return null;
   records.set(key, value);
   return 'OK';
  }),
  get: vi.fn(async (key: string) => records.get(key) ?? null),
  mget: vi.fn(async (...keys: string[]) => keys.map(key => records.get(key) ?? null)),
  del: vi.fn(async (...keys: string[]) => keys.reduce((count, key) => {
   const recordDeleted = records.delete(key);
   const setDeleted = guardSets.delete(key);
   return count + Number(recordDeleted || setDeleted);
  }, 0)),
  exists: vi.fn(async (key: string) => Number(records.has(key) || guardSets.has(key))),
  sscan: vi.fn(async (key: string, cursor: string, _count: string, size: number): Promise<[string, string[]]> => {
   if (cursor === '0') scans.set(key, [...(guardSets.get(key) ?? [])]);
   const snapshot = scans.get(key) ?? [];
   const start = Number(cursor);
   const next = start + size;
   return [next >= snapshot.length ? '0' : String(next),
    snapshot.slice(start, next).filter(member => guardSets.get(key)?.has(member))];
  }),
  srem: vi.fn(async (key: string, ...members: string[]) => {
   const set = guardSets.get(key);
   let removed = 0;
   for (const member of members) removed += Number(set?.delete(member) ?? false);
   if (set?.size === 0) guardSets.delete(key);
   return removed;
  }),
  multi: vi.fn(() => {
   const commands: Array<() => void> = [];
   const pipeline = {
    sadd: (key: string, member: string) => {
 commands.push(() => {
     if (!guardSets.has(key)) guardSets.set(key, new Set());
     guardSets.get(key)!.add(member);
    }); return pipeline;
},
    expire: (_key: string, _ttl: number) => { commands.push(() => {}); return pipeline; },
    exec: async () => { commands.forEach(run => run()); return commands.map(() => [null, 1]); },
   };
   return pipeline;
  }),

 };
 const users = new Map([
  ['user-a', { id: 'user-a', token: 'n'.repeat(16), host: null, isDeleted: false, isSuspended: false }],
  ['user-b', { id: 'user-b', token: 'b'.repeat(16), host: null, isDeleted: false, isSuspended: false }],
 ]);
 const repo = { findOneBy: vi.fn(async ({ id }: { id: string }) => users.get(id) ?? null) };
 const adminPolicy = { allows: vi.fn(async () => false) };
 const service = new ManafieldSessionService(redis as any, repo as any, adminPolicy as any);
 return { service, redis, users, records, guardSets, repo, adminPolicy };
}

const defaultGuard = 'g'.repeat(43);

function stubActiveCore() {
 vi.stubEnv('NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN', 'https://manafield.studio');
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: true }), {
  status: 200, headers: { 'Content-Type': 'application/json' },
 })));
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Independent Manafield browser sessions', () => {
 it('issues distinct high-entropy tokens without storing plaintext tokens', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, records } = fixture();
  const a = await service.issue('user-a', defaultGuard);
  const b = await service.issue('user-a', defaultGuard);
  expect(isManafieldBrowserSessionToken(a)).toBe(true);
  expect(a).not.toBe(b);
  expect([...records.keys()].join(' ')).not.toContain(a);
  expect(await service.resolve(a)).toMatchObject({ id: 'user-a' });
  expect(await service.resolve(b)).toMatchObject({ id: 'user-a' });
 });
 it('releases exactly one browser session and leaves other users and devices intact', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service } = fixture();
  const laptop = await service.issue('user-a', defaultGuard);
  const phone = await service.issue('user-a', defaultGuard);
  const other = await service.issue('user-b', defaultGuard);
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
  stubActiveCore();
  const { service, records, users } = fixture();
  expect(await service.resolve('x'.repeat(16))).toBeNull();
  expect(await service.revoke('mfs1_bad')).toBe(false);
  const token = await service.issue('user-a', defaultGuard);
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
  await expect(service.issue('user-a', defaultGuard)).rejects.toThrow();
  expect(await service.resolve('mfs1_' + 'a'.repeat(43))).toBeNull();
  expect(await service.revoke('mfs1_' + 'a'.repeat(43))).toBe(false);
  expect(redis.get).not.toHaveBeenCalled();
 });
 it('fails closed when the session store is unavailable', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, redis } = fixture();
  const token = await service.issue('user-a', defaultGuard);
  redis.get.mockRejectedValueOnce(new Error('redis unavailable'));
  await expect(service.resolve(token)).rejects.toThrow('redis unavailable');
 });
});

describe('Central Core logout rejects the corresponding Noctemblith session', () => {
 it('rejects newly issued unbound tokens and pre-feature Redis records', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, records } = fixture();
  await expect(service.issue('user-a')).rejects.toThrow('parent browser session required');
  const token = await service.issue('user-a', defaultGuard);
  const key = [...records.keys()][0];
  const old = JSON.parse(records.get(key)!) as Record<string, unknown>;
  delete old.centralGuard;
  records.set(key, JSON.stringify(old));
  expect(await service.resolve(token)).toBeNull();
  expect(await service.isActive(token)).toBe(false);
 });

 it("backchannel cleanup deletes only one central guard's local sessions and is idempotent", async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service } = fixture();
  const guardA = 'a'.repeat(43);
  const guardB = 'b'.repeat(43);
  const a1 = await service.issue('user-a', guardA);
  const a2 = await service.issue('user-b', guardA);
  const b = await service.issue('user-a', guardB);
  const guardHash = createHash('sha256').update(guardA).digest('hex');
  expect(await service.revokeByGuardHash(guardHash)).toBe(2);
  expect(await service.isActive(a1)).toBe(false);
  expect(await service.isActive(a2)).toBe(false);
  expect(await service.isActive(b)).toBe(true);
  expect(await service.revokeByGuardHash(guardHash)).toBe(0);
  await expect(service.revokeByGuardHash('invalid')).rejects.toThrow();
 });

 it('revokes all descendants of one parent but not another parent', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN', 'https://manafield.studio');
  const guards = new Map([['a'.repeat(43), true], ['b'.repeat(43), true]]);
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: { headers: Record<string, string> }) =>
   new Response(JSON.stringify({ active: guards.get(init.headers.Authorization.slice(7)) ?? false }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
   })));
  const { service } = fixture();
  const a1 = await service.issue('user-a', 'a'.repeat(43));
  const a2 = await service.issue('user-a', 'a'.repeat(43));
  const b = await service.issue('user-a', 'b'.repeat(43));
  expect(await service.revoke(a1)).toBe(true);
  expect(await service.isActive(a2)).toBe(true); // module-only logout
  guards.set('a'.repeat(43), false); // parent A logged out
  expect(await service.resolve(a2)).toBeNull();
  expect(await service.isActive(a2)).toBe(false);
  expect(await service.resolve(b)).toMatchObject({ id: 'user-a' });
 });

 it('blocks new children after a revocation even if Core still reports active', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, records } = fixture();
  await service.revokeByGuardHash(createHash('sha256').update(defaultGuard).digest('hex'));
  await expect(service.issue('user-a', defaultGuard)).rejects.toThrow('parent session revoked');
  expect([...records.keys()].filter(key => key.includes('browser-session:'))).toHaveLength(0);
 });

 it('cleans up issuance when revocation overtakes index insertion', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, redis, records, guardSets } = fixture();
  const hash = createHash('sha256').update(defaultGuard).digest('hex');
  const originalMulti = redis.multi.getMockImplementation()!;
  redis.multi.mockImplementationOnce(() => {
   const pipeline = originalMulti();
   const exec = pipeline.exec;
   pipeline.exec = async () => {
    await service.revokeByGuardHash(hash); // cleanup sees no inserted index yet
    return exec();
   };
   return pipeline;
  });
  await expect(service.issue('user-a', defaultGuard)).rejects.toThrow('parent session revoked');
  expect([...records.keys()].filter(key => key.includes('browser-session:'))).toHaveLength(0);
  expect(guardSets.size).toBe(0);
 });

 it('rolls back issuance if Core revokes the parent during storage', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: ++calls === 1 }), {
   status: 200, headers: { 'Content-Type': 'application/json' },
  })));
  const { service, records, guardSets } = fixture();
  await expect(service.issue('user-a', defaultGuard)).rejects.toThrow('parent session revoked');
  expect(records.size).toBe(0);
  expect(guardSets.size).toBe(0);
 });

 it('removes a child if index registration fails', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, redis, records, guardSets } = fixture();
  redis.multi.mockImplementationOnce(() => { throw new Error('index unavailable'); });
  await expect(service.issue('user-a', defaultGuard)).rejects.toThrow('index unavailable');
  expect(records.size).toBe(0);
  expect(guardSets.size).toBe(0);
 });

 it('keeps failed deletions indexed for retry and preserves other parents', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, redis, guardSets } = fixture();
  const a = await service.issue('user-a', defaultGuard);
  const b = await service.issue('user-a', 'b'.repeat(43));
  const hash = createHash('sha256').update(defaultGuard).digest('hex');
  redis.del.mockRejectedValueOnce(new Error('delete failed'));
  await expect(service.revokeByGuardHash(hash)).rejects.toThrow('delete failed');
  expect(guardSets.get('noctemblith:manafield:guard-sessions:' + hash)?.size).toBe(1);
  expect(await service.revokeByGuardHash(hash)).toBe(1);
  expect(await service.isActive(a)).toBe(false);
  expect(await service.isActive(b)).toBe(true);
  expect(await service.revokeByGuardHash(hash)).toBe(0);
 });

 it('drains multiple scan pages, tolerates duplicate entries and expired children', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, redis, records, guardSets } = fixture();
  const hash = createHash('sha256').update(defaultGuard).digest('hex');
  const index = 'noctemblith:manafield:guard-sessions:' + hash;
  const keys = Array.from({ length: 205 }, (_, i) =>
   'noctemblith:manafield:browser-session:' + i.toString(16).padStart(64, '0'));
  guardSets.set(index, new Set(keys));
  for (const key of keys.slice(1)) records.set(key, JSON.stringify({ centralGuard: defaultGuard })); // first child already expired
  const scan = redis.sscan.getMockImplementation()!;
  redis.sscan.mockImplementation(async (...args) => {
   const [cursor, members] = await scan(...args);
   return [cursor, [...members, ...members.slice(0, 1)]];
  });
  expect(await service.revokeByGuardHash(hash)).toBe(204);
  expect(redis.sscan).toHaveBeenCalledTimes(3);
  expect(redis.del.mock.calls.every(args => args.length <= 100)).toBe(true);
  expect(guardSets.has(index)).toBe(false);
  expect(await service.revokeByGuardHash(hash)).toBe(0);
 });

 it('rejects corrupt indexes without deleting unrelated Redis keys', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, redis, guardSets, records } = fixture();
  const hash = createHash('sha256').update(defaultGuard).digest('hex');
  guardSets.set('noctemblith:manafield:guard-sessions:' + hash, new Set(['unrelated-key']));
  records.set('unrelated-key', 'preserve');
  await expect(service.revokeByGuardHash(hash)).rejects.toThrow('Corrupt guard session index');
  expect(records.get('unrelated-key')).toBe('preserve');
  expect(redis.del).not.toHaveBeenCalled();
 });

 it('never deletes another parent session even if its key appears in the wrong index', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, guardSets, records } = fixture();
  const tokenB = await service.issue('user-a', 'b'.repeat(43));
  const hashA = createHash('sha256').update(defaultGuard).digest('hex');
  guardSets.set('noctemblith:manafield:guard-sessions:' + hashA, new Set(records.keys()));
  await expect(service.revokeByGuardHash(hashA)).rejects.toThrow('Corrupt guard session index');
  expect(await service.isActive(tokenB)).toBe(true);
 });

 it('rejects syntactically valid JSON with an invalid session shape', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, records } = fixture();
  const token = await service.issue('user-a', defaultGuard);
  const key = [...records.keys()][0];
  for (const raw of ['null', '[]', '{}', JSON.stringify({ centralGuard: defaultGuard })]) {
   records.set(key, raw);
   expect(await service.resolve(token)).toBeNull();
   expect(await service.isActive(token)).toBe(false);
  }
 });

 it('isolates central browser A from browser B and leaves B usable', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN', 'https://manafield.studio');
  const guards = new Map([['a'.repeat(43), true], ['b'.repeat(43), true]]);
  const status = vi.fn(async (_url: unknown, init: { headers: Record<string, string> }) => {
   const guard = init.headers.Authorization.slice('Bearer '.length);
   return new Response(JSON.stringify({ active: guards.get(guard) ?? false }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
   });
  });
  vi.stubGlobal('fetch', status);
  const { service } = fixture();
  const laptop = await service.issue('user-a', 'a'.repeat(43));
  const mobile = await service.issue('user-a', 'b'.repeat(43));
  expect(await service.resolve(laptop)).toMatchObject({ id: 'user-a' });
  expect(await service.resolve(mobile)).toMatchObject({ id: 'user-a' });
  guards.set('a'.repeat(43), false); // Account Core browser A logged out
  expect(await service.resolve(laptop)).toBeNull();
  expect(await service.isActive(laptop)).toBe(false);
  expect(await service.resolve(mobile)).toMatchObject({ id: 'user-a' });
  expect(await service.isActive(mobile)).toBe(true);
  expect(status).toHaveBeenCalled();
 });

 it('fails closed if Account Core guard status is unreachable or malformed', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN', 'https://manafield.studio');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: true }), {
   status: 200, headers: { 'Content-Type': 'application/json' },
  })));
  const { service } = fixture();
  const token = await service.issue('user-a', 'a'.repeat(43));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Core unavailable'); }));
  await expect(service.resolve(token)).rejects.toThrow('Core unavailable');
  await expect(service.isActive(token)).rejects.toThrow('Core unavailable');
 });
});

describe('Unlinked local administrator browser sessions', () => {
 it('issues revocable per-browser admin tokens without any Core dependency', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const fetcher = vi.fn(() => { throw new Error('Core must not be contacted'); });
  vi.stubGlobal('fetch', fetcher);
  const { service, users, adminPolicy } = fixture();
  adminPolicy.allows.mockResolvedValue(true);
  const a = await service.issueLocalAdmin(users.get('user-a')! as any);
  const b = await service.issueLocalAdmin(users.get('user-a')! as any);
  expect(a).toMatch(/^nla1_[A-Za-z0-9_-]{43}$/);
  expect(a).not.toBe(b);
  expect(await service.resolve(a)).toMatchObject({ id: 'user-a' });
  expect(await service.isActive(a)).toBe(true);
  expect(await service.revoke(a)).toBe(true);
  expect(await service.resolve(a)).toBeNull();
  expect(await service.isActive(b)).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
 });

 it('denies ordinary or linked accounts and rechecks eligibility on each request', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const { service, users, adminPolicy } = fixture();
  const user = users.get('user-a')! as any;
  await expect(service.issueLocalAdmin(user)).rejects.toThrow('not permitted');
  adminPolicy.allows.mockResolvedValue(true);
  const token = await service.issueLocalAdmin(user);
  adminPolicy.allows.mockResolvedValue(false);
  expect(await service.resolve(token)).toBeNull();
  expect(await service.isActive(token)).toBe(false);
 });

 it('does not accept an admin record under a central token or vice versa', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  stubActiveCore();
  const { service, records, users, adminPolicy } = fixture();
  adminPolicy.allows.mockResolvedValue(true);
  const admin = await service.issueLocalAdmin(users.get('user-a')! as any);
  const central = await service.issue('user-a', defaultGuard);
  const adminKey = 'noctemblith:manafield:browser-session:' + createHash('sha256').update(admin).digest('hex');
  const centralKey = 'noctemblith:manafield:browser-session:' + createHash('sha256').update(central).digest('hex');
  const adminRecord = records.get(adminKey)!;
  records.set(adminKey, records.get(centralKey)!);
  records.set(centralKey, adminRecord);
  expect(await service.resolve(admin)).toBeNull();
  expect(await service.resolve(central)).toBeNull();
  expect(await service.isActive(central)).toBe(false);
 });

 it('cleans up issuance if admin access is removed while allocating the token', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
  const { service, records, users, adminPolicy } = fixture();
  adminPolicy.allows.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(service.issueLocalAdmin(users.get('user-a')! as any)).rejects.toThrow('not permitted');
  expect(records.size).toBe(0);
 });

 it('never enables the recovery session store in standalone mode', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', '');
  const { service, users, adminPolicy, redis } = fixture();
  await expect(service.issueLocalAdmin(users.get('user-a')! as any)).rejects.toThrow();
  expect(await service.resolve('nla1_' + 'a'.repeat(43))).toBeNull();
  expect(adminPolicy.allows).not.toHaveBeenCalled();
  expect(redis.set).not.toHaveBeenCalled();
 });
});

it('invalidates every local admin browser session after native-token regeneration', async () => {
 vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
 const { service, users, adminPolicy, records } = fixture();
 adminPolicy.allows.mockResolvedValue(true);
 const admin = users.get('user-a')!;
 const a = await service.issueLocalAdmin(admin as any);
 const b = await service.issueLocalAdmin(admin as any);
 expect([...records.values()].join(' ')).not.toContain(admin.token);
 expect(await service.isActive(a)).toBe(true);
 admin.token = 'r'.repeat(16);
 expect(await service.resolve(a)).toBeNull();
 expect(await service.isActive(b)).toBe(false);
});
