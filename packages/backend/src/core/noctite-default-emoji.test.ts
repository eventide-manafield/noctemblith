/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { seedNoctiteEmoji } from '@/core/noctite-default-emoji.js';
import type { DataSource } from 'typeorm';

function makeFakeDb(existing: Record<string, any> | null = null) {
	const values = existing ? [existing] : [] as Record<string, any>[];
	const queries: string[] = [];
	const insert = vi.fn(async (_entity: unknown, value: Record<string, any>) => {
		values.push({ ...value });
	});
	const findOneBy = vi.fn(async (_entity: unknown, where: Record<string, unknown>) => {
		expect(where.name).toBe('noctite');
		expect(where.host).toBeDefined(); // TypeORM IsNull(), not a literal null
		return values.find(value => value.name === 'noctite' && value.host === null) ?? null;
	});
	const manager = {
		query: vi.fn(async (sql: string) => { queries.push(sql); }),
		findOneBy,
		insert,
	};
	const db = {
		transaction: vi.fn(async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager)),
	} as unknown as DataSource;
	return { db, values, manager, queries, insert, findOneBy };
}

describe('Noctite first-run custom emoji', () => {
	it('registers a normal local public :noctite: exactly once', async () => {
		const state = makeFakeDb();
		const generateId = vi.fn(() => 'aidx-test-emoji');
		const first = await seedNoctiteEmoji(state.db, 'https://noctite.example/', generateId);
		expect(first).toBe('aidx-test-emoji');
		expect(state.values).toHaveLength(1);
		expect(state.values[0]).toMatchObject({
			name: 'noctite',
			host: null,
			category: 'Noctite',
			aliases: [],
			originalUrl: 'https://noctite.example/static-assets/noctite-emoji.png',
			publicUrl: 'https://noctite.example/static-assets/noctite-emoji.png',
			type: 'image/png',
			isSensitive: false,
			localOnly: false,
			roleIdsThatCanBeUsedThisEmojiAsReaction: [],
		});
		expect(state.queries[0]).toMatch(/pg_advisory_xact_lock/);

		const second = await seedNoctiteEmoji(state.db, 'https://noctite.example/', generateId);
		expect(second).toBeNull();
		expect(generateId).toHaveBeenCalledTimes(1);
		expect(state.insert).toHaveBeenCalledTimes(1);
	});

	it('never overwrites or relabels an existing local :noctite:', async () => {
		const original = {
			id: 'already-owned',
			name: 'noctite',
			host: null,
			originalUrl: 'https://example.org/owner.png',
			publicUrl: 'https://example.org/owner.png',
			category: 'My custom category',
			localOnly: true,
		};
		const state = makeFakeDb({ ...original });
		const generateId = vi.fn();
		expect(await seedNoctiteEmoji(state.db, 'https://noctite.example/', generateId)).toBeNull();
		expect(state.values).toEqual([original]);
		expect(state.insert).not.toHaveBeenCalled();
		expect(generateId).not.toHaveBeenCalled();
	});

	it('does not confuse a remote emoji with an existing local emoji', async () => {
		const state = makeFakeDb({ name: 'noctite', host: 'remote.example', id: 'remote-one' });
		const result = await seedNoctiteEmoji(state.db, 'https://noctite.example/', () => 'local-one');
		expect(result).toBe('local-one');
		expect(state.values).toHaveLength(2);
		expect(state.values[1].host).toBeNull();
	});

	it('never generates off-site or HTTP emoji image URLs', async () => {
		const state = makeFakeDb();
		await expect(seedNoctiteEmoji(state.db, 'http://noctite.example/', () => 'unused'))
			.rejects.toThrow(/trusted HTTPS/);
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.db.transaction).not.toHaveBeenCalled();
	});

	it('fails startup loudly if DB insertion fails', async () => {
		const state = makeFakeDb();
		state.insert.mockRejectedValueOnce(new Error('db unavailable'));
		await expect(seedNoctiteEmoji(state.db, 'https://noctite.example/', () => 'new-id'))
			.rejects.toThrow('db unavailable');
	});
});
