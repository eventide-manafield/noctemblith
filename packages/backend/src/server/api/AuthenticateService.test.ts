/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it, vi } from 'vitest';
import { AuthenticateService, AuthenticationError } from './AuthenticateService.js';

function fixture(linked: boolean, integrated: boolean) {
 const user = { id: 'local-a', host: null, token: 'n'.repeat(16), isSuspended: false, isDeleted: false };
 const users = { findOneBy: vi.fn(async ({ token, id }: { token?: string; id?: string }) =>
  token === user.token || id === user.id ? user : null) };
 const db = { query: vi.fn(async () => linked ? [{ one: 1 }] : []) };
 const cache = { localUserByNativeTokenCache: { fetch: vi.fn(async (_token: string, getter: () => Promise<any>) => getter()) } };
 const sessions = { enabled: integrated, resolve: vi.fn(async () => user) };
 const service = new AuthenticateService(users as any, db as any,
  {} as any, {} as any, cache as any, sessions as any);
 return { service, db, sessions, users, user };
}
describe('Noctemblith auth respects device session revocation', () => {
 it('allows a revocable browser session token and validates it through the session store', async () => {
  const { service, sessions } = fixture(true, true);
  const token = 'mfs1_' + 'a'.repeat(43);
  expect((await service.authenticate(token))[0]?.id).toBe('local-a');
  expect(sessions.resolve).toHaveBeenCalledWith(token);
  sessions.resolve.mockResolvedValueOnce(null as any);
  await expect(service.authenticate(token)).rejects.toThrow(AuthenticationError);
 });
 it('does not allow the shared native token to bypass logout for a linked user', async () => {
  const { service, db } = fixture(true, true);
  await expect(service.authenticate('n'.repeat(16))).rejects.toThrow(AuthenticationError);
  expect(db.query).toHaveBeenCalledOnce();
 });
 it('keeps native credential proof available only to account-linking and keeps unlinked admin access', async () => {
  const linked = fixture(true, true);
  expect(await linked.service.authenticateNativeForLink('n'.repeat(16))).toMatchObject({ id: 'local-a' });
  await expect(linked.service.authenticate('n'.repeat(16))).rejects.toThrow(AuthenticationError);
  const unlinked = fixture(false, true);
  expect((await unlinked.service.authenticate('n'.repeat(16)))[0]?.id).toBe('local-a');
 });
 it('preserves standalone native authentication unchanged', async () => {
  const { service, db } = fixture(true, false);
  expect((await service.authenticate('n'.repeat(16)))[0]?.id).toBe('local-a');
  expect(db.query).not.toHaveBeenCalled();
 });
});
