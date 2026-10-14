/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IsNull } from 'typeorm';
import { MiEmoji } from '@/models/Emoji.js';
import type { DataSource } from 'typeorm';

const DEFAULT_EMOJI_BOOTSTRAP_KEY = 'default-noctemblith-emoji-v1';

/**
 * Install Noctemblith's signature emoji as an ordinary, editable custom emoji.
 *
 * This is a **one-time installation**, NOT an enforcement hook:
 * the persistent bootstrap marker means a deleted emoji stays deleted,
 * including after upgrades and restarts.
 *
 * The advisory lock serializes multiple bootstrapping processes.
 * UNIQUE(name, host) alone is insufficient for local emojis: PostgreSQL
 * permits multiple (name, NULL) rows under a regular unique constraint.
 */
export async function seedNoctemblithEmoji(
	db: DataSource,
	instanceUrl: string,
	generateId: () => string,
): Promise<string | null> {
	const url = new URL('/static-assets/noctemblith-emoji.png', instanceUrl);
	if (!['https:', 'http:'].includes(url.protocol)) {
		throw new Error('Noctemblith default emoji requires the configured HTTP(S) instance origin');
	}

	return db.transaction(async manager => {
		await manager.query("SELECT pg_advisory_xact_lock(hashtext('noctemblith'), hashtext('default-emoji'))");

		// The marker survives emoji deletion, so restarting Noctemblith cannot
		// resurrect an emoji the instance administrator intentionally deleted.
		const installed = await manager.query(
			'SELECT 1 FROM "noctemblith_bootstrap_state" WHERE "key" = $1',
			[DEFAULT_EMOJI_BOOTSTRAP_KEY],
		);
		if (installed.length !== 0) return null;

		// Adopt an existing :noctemblith: without ever overwriting its content.
		const found = await manager.findOneBy(MiEmoji, {
			name: 'noctemblith',
			host: IsNull(),
		});

		let createdId: string | null = null;
		if (found === null) {
			createdId = generateId();
			await manager.insert(MiEmoji, {
				id: createdId,
				updatedAt: new Date(),
				name: 'noctemblith',
				host: null,
				category: 'Noctemblith',
				aliases: [],
				originalUrl: url.toString(),
				publicUrl: url.toString(),
				type: 'image/png',
				license: null,
				isSensitive: false,
				localOnly: false,
				roleIdsThatCanBeUsedThisEmojiAsReaction: [],
			});
		}

		// This completes initialization even when a matching emoji already
		// existed. Both writes share a transaction: failure rolls both back.
		await manager.query(
			'INSERT INTO "noctemblith_bootstrap_state" ("key") VALUES ($1)',
			[DEFAULT_EMOJI_BOOTSTRAP_KEY],
		);
		return createdId;
	});
}
