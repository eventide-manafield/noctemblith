/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IsNull } from 'typeorm';
import { MiEmoji } from '@/models/Emoji.js';
import type { DataSource } from 'typeorm';

/**
 * Install Noctite's signature emoji into each independent instance.
 *
 * Using the existing emoji table means every standard API, cache, reaction,
 * and ActivityPub path works without a separate hard-coded emoji list.
 * The PostgreSQL transaction-level advisory lock serializes startup workers;
 * the ordinary (name, host) unique index does not make NULL local hosts
 * unique in PostgreSQL, so a simple ON CONFLICT is NOT sufficient here.
 *
 * Existing :noctite: records (including administrator modifications) win.
 * If deleted, a later boot restores the default, by Noctite policy.
 */
export async function seedNoctiteEmoji(
	db: DataSource,
	instanceUrl: string,
	generateId: () => string,
): Promise<string | null> {
	const url = new URL('/static-assets/noctite-emoji.png', instanceUrl);
	if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
		throw new Error('Noctite default emoji requires a trusted HTTPS instance URL');
	}

	return db.transaction(async manager => {
		// Constant lock keys; serialized across separate NestJS workers.
		await manager.query("SELECT pg_advisory_xact_lock(hashtext('noctite'), hashtext('default-emoji'))");

		const found = await manager.findOneBy(MiEmoji, {
			name: 'noctite',
			host: IsNull(),
		});
		if (found !== null) return null;

		const id = generateId();
		await manager.insert(MiEmoji, {
			id,
			updatedAt: new Date(),
			name: 'noctite',
			host: null,
			category: 'Noctite',
			aliases: [],
			originalUrl: url.toString(),
			publicUrl: url.toString(),
			type: 'image/png',
			license: null,
			isSensitive: false,
			localOnly: false,
			roleIdsThatCanBeUsedThisEmojiAsReaction: [],
		});
		return id;
	});
}
