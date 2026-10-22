/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import type { MiLocalUser } from '@/models/User.js';

/** Local recovery access is restricted to unlinked server administrators. */
@Injectable()
export class ManafieldLocalAdminPolicyService {
 constructor(
  @Inject(DI.db) private db: DataSource,
  private roleService: RoleService,
 ) {}

 async allowsCentral(user: MiLocalUser): Promise<boolean> {
  // A session issued before privilege promotion must not bypass local MFA.
  return !await this.roleService.isModerator(user);
 }

 async allows(user: MiLocalUser): Promise<boolean> {
  if (user.host !== null || user.isSuspended || user.isDeleted) return false;
  if (!await this.roleService.isAdministrator(user)) return false;
  const links = await this.db.query(
   'SELECT 1 FROM "manafield_identity_link" WHERE "userId" = $1 LIMIT 1', [user.id],
  ) as unknown[];
  return links.length === 0;
 }
}
