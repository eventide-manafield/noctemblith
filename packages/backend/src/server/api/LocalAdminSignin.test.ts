/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SigninApiService } from './SigninApiService.js';
import { SigninWithPasskeyApiService } from './SigninWithPasskeyApiService.js';
import { SigninService } from './SigninService.js';
import { ApiServerService } from './ApiServerService.js';

vi.mock('./endpoints.js', () => ({ default: [] }));

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
 await Promise.all(apps.splice(0).map(app => app.close()));
});

function fixture(integrated = true) {
 const config = { url: 'https://noctemblith.example', enableIpRateLimit: false, maxFileSize: 1024 };
 const user = { id: 'admin', username: 'admin', host: null, token: 'n'.repeat(16), isSuspended: false };
 const profile = { password: bcrypt.hashSync('correct-password', 4), twoFactorEnabled: true,
  usePasswordLessLogin: true, email: null };
 const users = { findOneBy: vi.fn(async () => user) };
 const profiles = { findOneByOrFail: vi.fn(async () => profile) };
 const signins = { insertOne: vi.fn(async () => ({})), insert: vi.fn(async () => ({})) };
 const sessions = { enabled: integrated, issue: vi.fn(),
  issueLocalAdmin: vi.fn(async () => 'nla1_' + 'a'.repeat(43)) };
 const signer = new SigninService(signins as any, profiles as any,
  { pack: vi.fn(async () => ({})) } as any, {} as any,
  { createNotification: vi.fn() } as any, { gen: () => 'record' } as any,
  { publishMainStream: vi.fn() } as any, sessions as any);
 const auth = { twoFactorAuthenticate: vi.fn(async () => {}) };
 const webAuthn = { initiateSignInWithPasskeyAuthentication: vi.fn(async () => ({ challenge: 'challenge' })),
  verifySignInWithPasskeyAuthentication: vi.fn(async () => user.id),
  verifyAuthentication: vi.fn(async () => true) };
 const logger = { getLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) };
 const rate = { limit: vi.fn(async () => null) };
 const ids = { gen: () => 'record' };
 const passwords = new SigninApiService(config as any, {} as any, users as any, profiles as any,
  { countBy: vi.fn(async () => 0) } as any, signins as any, logger as any, ids as any,
  rate as any, signer, auth as any, webAuthn as any, {} as any);
 const passkeys = new SigninWithPasskeyApiService(config as any, users as any, profiles as any,
  signins as any, ids as any, rate as any, signer, webAuthn as any, logger as any);
 const api = new ApiServerService({} as any, config as any, {} as any, {} as any, {} as any,
  {} as any, {} as any, passwords, passkeys);
 const app = Fastify();
 app.register(api.createServer, { prefix: '/api' });
 apps.push(app);
 return { app, profile, sessions, users, auth, webAuthn, user };
}

describe('Native and hidden administrator HTTP login routes', () => {
 it('blocks ordinary integrated password and passkey API calls, ignoring client admin claims', async () => {
  const { app, users, sessions } = fixture();
  for (const url of ['/api/signin-flow', '/api/signin-with-passkey']) {
   const response = await app.inject({ method: 'POST', url,
    payload: { username: 'admin', password: 'correct-password', localAdmin: true } });
   expect(response.statusCode).toBe(403);
   expect(response.json().error.code).toBe('MANAFIELD_LOGIN_REQUIRED');
  }
  expect(users.findOneBy).not.toHaveBeenCalled();
  expect(sessions.issueLocalAdmin).not.toHaveBeenCalled();
 });

 it('requires the existing password and TOTP flow before issuing any admin token', async () => {
  const { app, sessions, auth } = fixture();
  const url = '/api/local-admin/signin-flow';
  const first = await app.inject({ method: 'POST', url,
   payload: { username: 'admin', password: 'correct-password' } });
  expect(first.json()).toEqual({ finished: false, next: 'totp' });
  expect(sessions.issueLocalAdmin).not.toHaveBeenCalled();
  auth.twoFactorAuthenticate.mockRejectedValueOnce(new Error('bad TOTP'));
  const bad = await app.inject({ method: 'POST', url,
   payload: { username: 'admin', password: 'correct-password', token: '000000' } });
  expect(bad.statusCode).toBe(403);
  expect(sessions.issueLocalAdmin).not.toHaveBeenCalled();
  const good = await app.inject({ method: 'POST', url,
   payload: { username: 'admin', password: 'correct-password', token: '123456' } });
  expect(good.statusCode).toBe(200);
  expect(good.json().i).toMatch(/^nla1_/);
  expect(sessions.issue).not.toHaveBeenCalled();
  await new Promise(resolve => setImmediate(resolve));
 });

 it('rejects a wrong password even if a TOTP is supplied', async () => {
  const { app, sessions } = fixture();
  const response = await app.inject({ method: 'POST', url: '/api/local-admin/signin-flow',
   payload: { username: 'admin', password: 'wrong-password', token: '123456' } });
  expect(response.statusCode).toBe(403);
  expect(sessions.issueLocalAdmin).not.toHaveBeenCalled();
 });

 it('requires a verified enabled passkey before issuing an admin token', async () => {
  const { app, sessions, webAuthn } = fixture();
  const url = '/api/local-admin/signin-with-passkey';
  const challenge = await app.inject({ method: 'POST', url, payload: {} });
  const context = challenge.json().context;
  expect(challenge.statusCode).toBe(200);
  expect(sessions.issueLocalAdmin).not.toHaveBeenCalled();
  webAuthn.verifySignInWithPasskeyAuthentication.mockResolvedValueOnce(null as any);
  const bad = await app.inject({ method: 'POST', url, payload: { context, credential: {} } });
  expect(bad.statusCode).toBe(403);
  expect(sessions.issueLocalAdmin).not.toHaveBeenCalled();
  const good = await app.inject({ method: 'POST', url, payload: { context, credential: {} } });
  expect(good.statusCode).toBe(200);
  expect(good.json().signinResponse.i).toMatch(/^nla1_/);
  await new Promise(resolve => setImmediate(resolve));
 });

 it('does not grant a session to an ineligible account after valid local authentication', async () => {
  const { app, sessions } = fixture();
  sessions.issueLocalAdmin.mockRejectedValueOnce(new Error('ordinary or linked account'));
  const response = await app.inject({ method: 'POST', url: '/api/local-admin/signin-flow',
   payload: { username: 'admin', password: 'correct-password', token: '123456' } });
  expect(response.statusCode).toBe(403);
  expect(response.json().i).toBeUndefined();
 });

 it('keeps standalone native login and leaves its integration admin endpoints unavailable', async () => {
  const { app, user } = fixture(false);
  const response = await app.inject({ method: 'POST', url: '/api/signin-flow',
   payload: { username: 'admin', password: 'correct-password', token: '123456' } });
  expect(response.statusCode).toBe(200);
  expect(response.json().i).toBe(user.token);
  for (const url of ['/api/local-admin/signin-flow', '/api/local-admin/signin-with-passkey']) {
   expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(404);
  }
  await new Promise(resolve => setImmediate(resolve));
 });
});
