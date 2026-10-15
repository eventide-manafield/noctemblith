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

 const user = { id: 'local-eventide', username: 'eventide', host: null, isSuspended: false, isDeleted: false, token: nativeToken };
 const otherUser = { id: 'local-alice', username: 'alice', host: null, isSuspended: false, isDeleted: false, token: 'a'.repeat(16) };
 const createdUsers: Array<typeof user> = [];
 const values = new Map<string, string>();
 const rateCounts = new Map<string, number>();
 const links = new Map<string, string>();
 const redis = {
  incr: vi.fn(async (key: string) => {
   const count = (rateCounts.get(key) ?? 0) + 1;
   rateCounts.set(key, count);
   return count;
  }),
  expire: vi.fn(async () => 1),
  set: vi.fn(async (key: string, value: string) => {
   if (values.has(key)) return null;
   values.set(key, value);
   return 'OK';
  }),
  get: vi.fn(async (key: string) => values.get(key) ?? null),
  getdel: vi.fn(async (key: string) => {
   const value = values.get(key) ?? null;
   values.delete(key);
   return value;
  }),
 };
 const db = {
  query: vi.fn(async (query: string, args: unknown[]) => {
   if (query.includes('SELECT "rootUserId" FROM "meta"')) return [{ rootUserId: user.id }];
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
 const repository = { findOneBy: vi.fn(async ({ id, usernameLower }: { id?: string; usernameLower?: string }) =>
  [user, otherUser, ...createdUsers].find(u => id ? u.id === id : u.username.toLowerCase() === usernameLower) ?? null) };
 const auth = { authenticate: vi.fn(async (token: string) =>
  [user, otherUser].find(u => u.token === token) ? [[user, otherUser].find(u => u.token === token), null] : [null, null]) };
 const role = { isModerator: vi.fn(async () => false) };
 const signin = { signin: vi.fn((_request: unknown, reply: { code(n: number): unknown }, u: typeof user) => {
  reply.code(200);
  return { finished: true, id: u.id, i: u.token };
 }) };
 const config = { url: ownOrigin + '/' };
 const signup = {
  signup: vi.fn(async (args: { username: string; onCreatedInTransaction?: (manager: unknown, user: typeof user) => Promise<void> }) => {
   if (createdUsers.some(u => u.username === args.username)) throw new Error('duplicate username');
   const created = { ...user, id: 'jit-' + args.username, username: args.username, token: 'j'.repeat(16) };
   await args.onCreatedInTransaction?.({ query: db.query }, created);
   createdUsers.push(created);
   return { account: created, secret: created.token };
  }),
 };

 const service = new ManafieldSsoService(config as any, redis as any, db as any,
  repository as any, auth as any, role as any, signin as any, signup as any);
 const app = Fastify();
 service.registerRoutes(app);
 return { app, user, otherUser, createdUsers, redis, db, links, role, signin, signup };
}

function stubIssuer(identity: { sub: string; preferred_username: string; profile_handle?: string | null } =
 { sub: centralSub, preferred_username: 'eventide' }) {
 const mock = vi.fn(async (value: string | URL) => {
  const pathname = new URL(String(value)).pathname;
  if (pathname === '/account/oauth/token') {
   return new Response(JSON.stringify({ token_type: 'Bearer', access_token: 't'.repeat(43), expires_in: 900 }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (pathname === '/account/oauth/userinfo') {
   return new Response(JSON.stringify({ sub: identity.sub, preferred_username: identity.preferred_username }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (pathname === '/account/oauth/profile-handle') {
   const handle = Object.hasOwn(identity, 'profile_handle') ? identity.profile_handle : identity.preferred_username;
   return new Response(JSON.stringify({ sub: identity.sub, profile_handle: handle }),
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
   {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
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

 it('rate-limits repeated OAuth start attempts without storing client IPs', async () => {
  const { app } = createMockService();
  try {
   for (let i = 0; i < 10; i++) {
    const result = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
    expect(result.statusCode).toBe(303);
   }
   const blocked = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
   expect(blocked.statusCode).toBe(429);
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
   expect(issuer).toHaveBeenCalledTimes(3);
   expect((await app.inject({ method: 'GET', url, headers: { cookie: stateCookie } })).statusCode).toBe(400);
   expect(links.size).toBe(1);
  } finally { await app.close(); }
 });

 it('rejects cross-handle AB-BA ownership swaps before persisting a link', async () => {
  const { app, links } = createMockService();
  try {
   for (const { native, sub, handle } of [
    { native: nativeToken, sub: centralSub, handle: 'alice' },
    { native: 'a'.repeat(16), sub: '00000000-0000-4000-8000-000000000002', handle: 'eventide' },
   ]) {
    stubIssuer({ sub, preferred_username: handle });
    const start = await app.inject({ method: 'POST', url: '/auth/manafield/link/start',
     payload: {}, headers: { origin: ownOrigin, authorization: 'Bearer ' + native } });
    expect(start.statusCode).toBe(200);
    const auth = new URL(start.json().authorizationUrl);
    const cookie = cookieFromHeader(start.headers['set-cookie'], '__Host-noctemblith_manafield_state');
    const callback = await app.inject({ method: 'GET',
     url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + auth.searchParams.get('state'),
     headers: { cookie } });
    expect(callback.statusCode).toBe(303);
    expect(callback.headers.location).toBe('/settings/connect?manafield=conflict');
    expect(links.size).toBe(0);
   }
  } finally { await app.close(); }
 });

 it('rejects a preexisting UUID link when the local handle belongs to another account', async () => {
  const { app, links, signin } = createMockService();
  links.set(centralSub, 'local-alice');
  stubIssuer();
  try {
   const start = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
   const auth = new URL(start.headers.location as string);
   const cookie = cookieFromHeader(start.headers['set-cookie'], '__Host-noctemblith_manafield_state');
   const callback = await app.inject({ method: 'GET',
    url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + auth.searchParams.get('state'),
    headers: { cookie } });
   expect(callback.statusCode).toBe(303);
   expect(callback.headers.location).toBe('/auth/manafield/finish?status=failed');
   expect(signin.signin).not.toHaveBeenCalled();
  } finally { await app.close(); }
 });

 it('never issues a privileged native login token from central-only auth', async () => {
  const { app, links, role, signin } = createMockService();
  links.set(centralSub, 'local-eventide');
  role.isModerator.mockResolvedValue(true);
  stubIssuer();
  try {
   const started = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
   const callbackUrl = new URL(started.headers.location as string);
   const stateCookie = cookieFromHeader(started.headers['set-cookie'],
    '__Host-noctemblith_manafield_state');
   const verified = await app.inject({ method: 'GET',
    url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + callbackUrl.searchParams.get('state'),
    headers: { cookie: stateCookie } });
   expect(verified.statusCode).toBe(303);
   const ticket = new URL(verified.headers.location as string, ownOrigin).searchParams.get('ticket');
   const proof = cookieFromHeader(verified.headers['set-cookie'], '__Host-noctemblith_manafield_ticket');
   const finish = await app.inject({ method: 'POST', url: '/auth/manafield/login/finish',
    payload: { ticket }, headers: { origin: ownOrigin, cookie: proof } });
   expect(finish.statusCode).toBe(403);
   expect(finish.json()).toMatchObject({ error: 'privileged_account_requires_local_login' });
   expect(signin.signin).not.toHaveBeenCalled();
  } finally { await app.close(); }
 });

 it('rechecks handle and UUID link again when finishing an issued ticket', async () => {
  const { app, user, links, signin } = createMockService();
  links.set(centralSub, 'local-eventide');
  stubIssuer();
  try {
   const start = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
   const auth = new URL(start.headers.location as string);
   const stateCookie = cookieFromHeader(start.headers['set-cookie'], '__Host-noctemblith_manafield_state');
   const callback = await app.inject({ method: 'GET',
    url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + auth.searchParams.get('state'),
    headers: { cookie: stateCookie } });
   expect(callback.statusCode).toBe(303);
   const ticket = new URL(callback.headers.location as string, ownOrigin).searchParams.get('ticket');
   const cookie = cookieFromHeader(callback.headers['set-cookie'], '__Host-noctemblith_manafield_ticket');
   user.username = 'changed';
   const finished = await app.inject({ method: 'POST', url: '/auth/manafield/login/finish',
    payload: { ticket }, headers: { origin: ownOrigin, cookie } });
   expect(finished.statusCode).toBe(403);
   expect(finished.json()).toMatchObject({ error: 'identity_conflict' });
   expect(signin.signin).not.toHaveBeenCalled();
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

describe('Manafield consent-based just-in-time account provisioning', () => {
 const newSub = '00000000-0000-4000-8000-000000000055';
 const newIdentity = { sub: newSub, preferred_username: 'newobserver' };

 async function requestSignup(app: ReturnType<typeof Fastify>,
  identity: { sub: string; preferred_username: string; profile_handle?: string | null } = newIdentity) {
  stubIssuer(identity);
  const start = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
  expect(start.statusCode).toBe(303);
  const target = new URL(start.headers.location as string);
  const stateCookie = cookieFromHeader(start.headers['set-cookie'], '__Host-noctemblith_manafield_state');
  const callback = await app.inject({
   method: 'GET',
   url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + target.searchParams.get('state'),
   headers: { cookie: stateCookie },
  });
  return callback;
 }

 it('offers consent only to a verified unoccupied handle, then creates a linked actor and one-use login', async () => {
  const { app, links, createdUsers, signup, signin } = createMockService();
  try {
   const callback = await requestSignup(app);
   expect(callback.statusCode).toBe(303);
   expect(callback.headers.location).toBe('/auth/manafield/finish?status=signup');
   expect(createdUsers).toHaveLength(0);
   const cookie = cookieFromHeader(callback.headers['set-cookie'], '__Host-noctemblith_manafield_provision');

   const endpoint = '/auth/manafield/provision/status';
   const status = await app.inject({ method: 'POST', url: endpoint, payload: {},
    headers: { cookie, origin: ownOrigin } });
   expect(status.json()).toEqual({ handle: 'newobserver', actor: '@newobserver@noctemblith-dev.manafield.studio' });
   expect((await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: false }, headers: { cookie, origin: ownOrigin } })).statusCode).toBe(400);
   expect(createdUsers).toHaveLength(0);
   expect((await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: true }, headers: { cookie, origin: 'https://attacker.test' } })).statusCode).toBe(403);

   const accepted = await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: true }, headers: { cookie, origin: ownOrigin } });
   expect(accepted.statusCode).toBe(200);
   const ticket = accepted.json().ticket as string;
   expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
   expect(createdUsers.map(u => u.username)).toEqual(['newobserver']);
   expect(signup.signup).toHaveBeenCalledOnce();
   expect(links.get(newSub)).toBe('jit-newobserver');
   const proof = cookieFromHeader(accepted.headers['set-cookie'], '__Host-noctemblith_manafield_ticket');
   const finished = await app.inject({ method: 'POST', url: '/auth/manafield/login/finish',
    payload: { ticket }, headers: { cookie: proof, origin: ownOrigin } });
   expect(finished.statusCode).toBe(200);
   expect(finished.json()).toMatchObject({ finished: true, id: 'jit-newobserver' });
   expect(signin.signin).toHaveBeenCalledOnce();
   expect((await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: true }, headers: { cookie, origin: ownOrigin } })).statusCode).toBe(401);
  } finally { await app.close(); }
 });

 it('does not claim an existing native actor by matching its public username', async () => {
  const { app, signup } = createMockService();
  try {
   const callback = await requestSignup(app, { sub: newSub, preferred_username: 'eventide' });
   expect(callback.statusCode).toBe(303);
   expect(callback.headers.location).toBe('/auth/manafield/finish?status=unlinked');
   expect(signup.signup).not.toHaveBeenCalled();
  } finally { await app.close(); }
 });

 it('revalidates active central UUID and handle after consent before provisioning', async () => {
  const { app, signup, links } = createMockService();
  try {
   const callback = await requestSignup(app);
   const cookie = cookieFromHeader(callback.headers['set-cookie'], '__Host-noctemblith_manafield_provision');
   stubIssuer({ sub: '00000000-0000-4000-8000-000000000066', preferred_username: 'newobserver' });
   const result = await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: true }, headers: { cookie, origin: ownOrigin } });
   expect(result.statusCode).toBe(403);
   expect(result.json()).toMatchObject({ error: 'central_identity_changed' });
   expect(signup.signup).not.toHaveBeenCalled();
   expect(links.size).toBe(0);
  } finally { await app.close(); }
 });

 it('uses the verified Profile handle even when central login ID is different', async () => {
  const { app, createdUsers, links } = createMockService();
  try {
   const callback = await requestSignup(app, {
    sub: newSub, preferred_username: 'login_not_public', profile_handle: 'newobserver',
   });
   expect(callback.headers.location).toBe('/auth/manafield/finish?status=signup');
   const cookie = cookieFromHeader(callback.headers['set-cookie'], '__Host-noctemblith_manafield_provision');
   const response = await app.inject({ method: 'POST', url: '/auth/manafield/provision/status',
    payload: {}, headers: { origin: ownOrigin, cookie } });
   expect(response.statusCode).toBe(200);
   expect(response.json().actor).toBe('@newobserver@noctemblith-dev.manafield.studio');
   const created = await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: true }, headers: { origin: ownOrigin, cookie } });
   expect(created.statusCode).toBe(200);
   expect(createdUsers.map(u => u.username)).toEqual(['newobserver']);
   expect(links.get(newSub)).toBe('jit-newobserver');
  } finally { await app.close(); }
 });

 it('requires a registered Profile public handle before onboarding or linking', async () => {
  const { app, createdUsers, links } = createMockService();
  try {
   const callback = await requestSignup(app, {
    sub: newSub, preferred_username: 'some_login_id', profile_handle: null,
   });
   expect(callback.statusCode).toBe(303);
   expect(callback.headers.location).toBe('/auth/manafield/finish?status=handle-required');
   expect(createdUsers).toHaveLength(0);
   expect(links.size).toBe(0);

   stubIssuer({ sub: centralSub, preferred_username: 'another_login', profile_handle: null });
   const start = await app.inject({ method: 'POST', url: '/auth/manafield/link/start',
    payload: {}, headers: { origin: ownOrigin, authorization: 'Bearer ' + nativeToken } });
   const target = new URL(start.json().authorizationUrl);
   const stateCookie = cookieFromHeader(start.headers['set-cookie'], '__Host-noctemblith_manafield_state');
   const linked = await app.inject({ method: 'GET',
    url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + target.searchParams.get('state'),
    headers: { cookie: stateCookie } });
   expect(linked.statusCode).toBe(303);
   expect(linked.headers.location).toBe('/settings/connect?manafield=handle-required');
   expect(links.size).toBe(0);
  } finally { await app.close(); }
 });

 it('fails closed when the verified public handle changes before consent completes', async () => {
  const { app, createdUsers, links } = createMockService();
  try {
   const callback = await requestSignup(app, {
    sub: newSub, preferred_username: 'login_not_public', profile_handle: 'newobserver',
   });
   const cookie = cookieFromHeader(callback.headers['set-cookie'], '__Host-noctemblith_manafield_provision');
   stubIssuer({ sub: newSub, preferred_username: 'login_not_public', profile_handle: 'someone_else' });
   const result = await app.inject({ method: 'POST', url: '/auth/manafield/provision/confirm',
    payload: { consent: true }, headers: { cookie, origin: ownOrigin } });
   expect(result.statusCode).toBe(403);
   expect(result.json()).toMatchObject({ error: 'central_identity_changed' });
   expect(createdUsers).toHaveLength(0);
   expect(links.size).toBe(0);
  } finally { await app.close(); }
 });

 it('rechecks the Profile handle when redeeming an SSO ticket', async () => {
  const { app, links, signin } = createMockService();
  links.set(centralSub, 'local-eventide');
  stubIssuer({ sub: centralSub, preferred_username: 'different_login', profile_handle: 'eventide' });
  try {
   const start = await app.inject({ method: 'GET', url: '/auth/manafield/login/start' });
   const target = new URL(start.headers.location as string);
   const cookie = cookieFromHeader(start.headers['set-cookie'], '__Host-noctemblith_manafield_state');
   const callback = await app.inject({ method: 'GET',
    url: '/auth/manafield/callback?code=' + oauthCode + '&state=' + target.searchParams.get('state'),
    headers: { cookie } });
   expect(callback.statusCode).toBe(303);
   const url = new URL(callback.headers.location as string, ownOrigin);
   const ticket = url.searchParams.get('ticket');
   expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
   const proof = cookieFromHeader(callback.headers['set-cookie'], '__Host-noctemblith_manafield_ticket');
   stubIssuer({ sub: centralSub, preferred_username: 'different_login', profile_handle: 'other_handle' });
   const finish = await app.inject({ method: 'POST', url: '/auth/manafield/login/finish',
    payload: { ticket }, headers: { cookie: proof, origin: ownOrigin } });
   expect(finish.statusCode).toBe(403);
   expect(finish.json()).toMatchObject({ error: 'identity_conflict' });
   expect(signin.signin).not.toHaveBeenCalled();
  } finally { await app.close(); }
 });
});
