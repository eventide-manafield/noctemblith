/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManafieldSsoService } from './ManafieldSsoService.js';

const ownOrigin = 'https://noctemblith-dev.manafield.studio';
const centralSub = '00000000-0000-4000-8000-000000000001';
const nativeToken = 'n'.repeat(16);
const oauthCode = 'c'.repeat(43);

function cookieFromHeader(header: string | string[] | undefined, name: string): string {
 const list = typeof header === 'string' ? [header] : header ?? [];
 const found = list.find(s => s.startsWith(name + '=') && !s.includes('Max-Age=0'));
 if (!found) throw new Error('Expected proof cookie not set: ' + name);
 return found.split(';', 1)[0];
}

function createMockService() {
 vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', 'true');
 vi.stubEnv('NOCTEMBLITH_MANAFIELD_ACCOUNT_ORIGIN', 'https://manafield.studio');
 vi.stubEnv('NOCTEMBLITH_MANAFIELD_OAUTH_CLIENT_ID', 'manafield-noctemblith-dev');
 vi.stubEnv('NOCTEMBLITH_MANAFIELD_OAUTH_CALLBACK_URL', ownOrigin + '/auth/manafield/callback');

 const user = { id: 'local-eventide', host: null, isSuspended: false, isDeleted: false, token: nativeToken };
 const values = new Map<string, string>();
 const links = new Map<string, string>();
 const redis = {
  set: vi.fn(async (key: string, value: string) => {
   if (values.has(key)) return null;
   values.set(key, value);
   return 'OK';
  }),
  getdel: vi.fn(async (key: string) => {
   const value = values.get(key) ?? null;
   values.delete(key);
   return value;
  }),
 };
 const db = {
  query: vi.fn(async (query: string, args: unknown[]) => {
   if (query.includes('INSERT INTO "manafield_identity_link"')) {
    const subject = args[1] as string, userId = args[2] as string;
    if (links.has(subject) || [...links.values()].includes(userId)) return [];
    links.set(subject, userId);
    return [{ userId }];
   }
   if (query.includes('AS sub')) {
    return [...links].filter(([sub, id]) => sub === args[1] || id === args[2])
     .map(([sub, userId]) => ({ sub, userId }));
   }
   if (query.includes('SELECT 1 FROM')) {
    return [...links].filter(([, userId]) => userId === args[1]).map(() => ({ value: 1 }));
   }
   if (query.includes('SELECT "userId" FROM')) {
    const id = links.get(args[1] as string);
    return id ? [{ userId: id }] : [];
   }
   throw new Error('Unexpected mock SQL: ' + query);
  }),
 };
 const repository = { findOneBy: vi.fn(async ({ id }: { id: string }) => id === user.id ? user : null) };
 const auth = { authenticate: vi.fn(async (token: string) => token === nativeToken ? [user, null] : [null, null]) };
 const role = { isModerator: vi.fn(async () => false) };
 const signin = { signin: vi.fn((_request: unknown, reply: { code(n: number): unknown }, u: typeof user) => {
  reply.code(200);
  return { finished: true, id: u.id, i: u.token };
 }) };
 const config = { url: ownOrigin + '/' };

 const service = new ManafieldSsoService(config as any, redis as any, db as any,
  repository as any, auth as any, role as any, signin as any);
 const app = Fastify();
 service.registerRoutes(app);
 return { app, user, redis, db, links, role, signin };
}

function stubIssuer() {
 const mock = vi.fn(async (value: string | URL) => {
  const pathname = new URL(String(value)).pathname;
  if (pathname === '/account/oauth/token') {
   return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 't'.repeat(43), expires_in: 900 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (pathname === '/account/oauth/userinfo') {
   return new Response(JSON.stringify({ sub: centralSub, preferred_username: 'eventide' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('Unexpected external OAuth target');
 });
 vi.stubGlobal('fetch', mock);
 return mock;
}

afterEach(() => {
 vi.unstubAllGlobals();
 vi.unstubAllEnvs();
});

describe('Manafield dev SSO existing-account ownership', () => {
 it('is disabled by default, leaving local login intact', async () => {
  vi.stubEnv('NOCTEMBLITH_MANAFIELD_SSO_ENABLED', '');
  const service = new ManafieldSsoService({ url: ownOrigin } as any, {} as any,
   {} as any, {} as any, {} as any, {} as any, {} as any);
  const app = Fastify();
  service.registerRoutes(app);
  try {
   const status = await app.inject({ method: 'GET', url: '/auth/manafield/status' });
   expect(status.json()).toEqual({ enabled: false });
   expect((await app.inject({ method: 'GET', url: '/auth/manafield/login/start' })).statusCode).toBe(503);
  } finally { await app.close(); }
 });

 it('requires an authenticated local user and exact same-origin initiation', async () => {
  const { app } = createMockService();
  try {
   const url = '/auth/manafield/link/start';
   expect((await app.inject({ method: 'POST', url, payload: {}, headers: { origin: ownOrigin } })).statusCode).toBe(401);
   expect((await app.inject({ method: 'POST', url, payload: {}, headers: {
    origin: 'https://attacker.invalid', authorization: 'Bearer ' + nativeToken,
   } })).statusCode).toBe(403);
   expect((await app.inject({ method: 'POST', url, payload: {}, headers: {
    origin: 'null', authorization: 'Bearer ' + nativeToken,
   } })).statusCode).toBe(403);
   const good = await app.inject({ method: 'POST', url, payload: {}, headers: {
    origin: 'null', 'sec-fetch-site': 'same-origin', authorization: 'Bearer ' + nativeToken,
   } });
   expect(good.statusCode).toBe(200);
   expect(new URL(good.json().authorizationUrl).host).toBe('manafield.studio');
  } finally { await app.close(); }
 });

 it('requires the browser state cookie and consumes callback state only once', async () => {
  const { app, links } = createMockService();
  const issuer = stubIssuer();
  try {
   const start = await app.inject({ method: 'POST', url: '/auth/manafield/link/start',
    payload: {}, headers: { origin: ownOrigin, authorization: 'Bearer ' + nativeToken } });
   const stateCookie = cookieFromHeader(start.headers['set-cookie'],
    '__Host-noctemblith_manafield_state');
   const redirect = new URL(start.json().authorizationUrl);
   const url = '/auth/manafield/callback?code=' + oauthCode + '&state=' + redirect.searchParams.get('state');

   expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
   const linked = await app.inject({ method: 'GET', url, headers: { cookie: stateCookie } });
   expect(linked.statusCode).toBe(303);
   expect(linked.headers.location).toBe('/settings/connect?manafield=linked');
   expect(links.get(centralSub)).toBe('local-eventide');
   expect(issuer).toHaveBeenCalledTimes(2);
   expect((await app.inject({ method: 'GET', url, headers: { cookie: stateCookie } })).statusCode).toBe(400);
   expect(links.size).toBe(1);
  } finally { await app.close(); }
 });

 it('issues one-use, browser-bound tickets with no native token in redirect URLs', async () => {
  const { app, links } = createMockService();
  links.set(centralSub, 'local-eventide');
  stubIssuer();
  try {
   const start = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
   expect(start.statusCode).toBe(303);
   const auth = new URL(start.headers.location as string);
   const stateCookie = cookieFromHeader(start.headers['set-cookie'],
    '__Host-noctemblith_manafield_state');
   const callback = await app.inject({ method: 'GET',
    url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + auth.searchParams.get('state'),
    headers: { cookie: stateCookie } });
   expect(callback.statusCode).toBe(303);
   const location = callback.headers.location as string;
   expect(location).toContain('/auth/manafield/finish?ticket=');
   expect(location).not.toContain(nativeToken);
   const ticket = new URL(location, ownOrigin).searchParams.get('ticket');
   const proofCookie = cookieFromHeader(callback.headers['set-cookie'],
    '__Host-noctemblith_manafield_ticket');
   const endpoint = '/auth/manafield/login/finish';
   const good = await app.inject({ method: 'POST', url: endpoint, payload: { ticket },
    headers: { origin: ownOrigin, cookie: proofCookie } });
   expect(good.statusCode).toBe(200);
   expect(good.json()).toMatchObject({ finished: true, i: nativeToken });
   const replay = await app.inject({ method: 'POST', url: endpoint, payload: { ticket },
    headers: { origin: ownOrigin, cookie: proofCookie } });
   expect(replay.statusCode).toBe(400);
  } finally { await app.close(); }
 });
});
