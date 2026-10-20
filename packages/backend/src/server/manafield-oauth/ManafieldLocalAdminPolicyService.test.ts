/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, it, vi } from 'vitest';
import { ManafieldLocalAdminPolicyService } from './ManafieldLocalAdminPolicyService.js';

function fixture() {
 const db = { query: vi.fn(async () => [] as unknown[]) };
 const role = { isAdministrator: vi.fn(async () => true) };
 const policy = new ManafieldLocalAdminPolicyService(db as any, role as any);
 const user = { id: 'root', host: null, isDeleted: false, isSuspended: false };
 return { policy, role, db, user };
}

describe('Unlinked local administrator policy', () => {
 it('allows an active unlinked server administrator', async () => {
  const { policy, user, db } = fixture();
  expect(await policy.allows(user as any)).toBe(true);
  expect(db.query.mock.calls[0]).toEqual([
   'SELECT 1 FROM "manafield_identity_link" WHERE "userId" = $1 LIMIT 1', ['root'],
  ]);
 });
 it('rejects ordinary users and moderators without administrator permission', async () => {
  const { policy, user, role, db } = fixture();
  role.isAdministrator.mockResolvedValue(false);
  expect(await policy.allows(user as any)).toBe(false);
  expect(db.query).not.toHaveBeenCalled();
 });
 it('rejects administrators linked to a central identity', async () => {
  const { policy, user, db } = fixture();
  db.query.mockResolvedValue([{ one: 1 }]);
  expect(await policy.allows(user as any)).toBe(false);
 });
 it('rejects suspended, deleted and remote users', async () => {
  for (const change of [{ isSuspended: true }, { isDeleted: true }, { host: 'remote.example' }]) {
   const { policy, user, role } = fixture();
   expect(await policy.allows({ ...user, ...change } as any)).toBe(false);
   expect(role.isAdministrator).not.toHaveBeenCalled();
  }
 });
 it('fails closed if current role or link state cannot be checked', async () => {
  const { policy, user, db } = fixture();
  db.query.mockRejectedValueOnce(new Error('database unavailable'));
  await expect(policy.allows(user as any)).rejects.toThrow('database unavailable');
 });
});
