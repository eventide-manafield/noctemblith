/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { seedNoctiteEmoji } from '@/core/noctite-default-emoji.js';
import type { DataSource } from 'typeorm';

function makeFakeDb(existing: Record<string, unknown> | null = null) {
	const values: Record<string, unknown>[] = existing ? [{ ...existing }] : [];
	const queries: string[] = [];
	let installCompleted = false;

	const insert = vi.fn(async (_entity: unknown, value: Record<string, unknown>) => {
		values.push({ ...value });
	});
	const findOneBy = vi.fn(async (_entity: unknown, where: Record<string, unknown>) => {
		expect(where.name).toBe('noctite');
		expect(where.host).toBeDefined(); // TypeORM IsNull(), not a literal null
		return values.find(value => value.name === 'noctite' && value.host === null) ?? null;
	});
	const manager = {
		query: vi.fn(async (sql: string, params?: string[]) => {
			queries.push(sql);
			if (sql.startsWith('SELECT 1 FROM "noctite_bootstrap_state"')) {
				return installCompleted ? [{ one: 1 }] : [];
			}
			if (sql.startsWith('INSERT INTO "noctite_bootstrap_state"')) {
				expect(params).toEqual(['default-noctite-emoji-v1']);
				installCompleted = true;
			}
			return [];
		}),
		findOneBy,
		insert,
	};
	const db = {
		transaction: vi.fn(async (callback: (tx: typeof manager) => Promise<unknown>) => callback(manager)),
	} as unknown as DataSource;

	return { db, values, manager, queries, insert, findOneBy, installed: () => installCompleted };
}

describe('Noctite one-time initial custom emoji', () => {
	it('includes a normal local public :noctite: on first installation only', async () => {
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
		expect(state.installed()).toBe(true);

		const second = await seedNoctiteEmoji(state.db, 'https://noctite.example/', generateId);
		expect(second).toBeNull();
		expect(generateId).toHaveBeenCalledTimes(1);
		expect(state.insert).toHaveBeenCalledTimes(1);
	});

	it('does not resurrect a deleted emoji after restart', async () => {
		const state = makeFakeDb();
		const gen = vi.fn(() => 'initial-emoji');
		expect(await seedNoctiteEmoji(state.db, 'https://noctite.example/', gen)).toBe('initial-emoji');
		state.values.splice(0, state.values.length); // admin deleted the emoji
		expect(await seedNoctiteEmoji(state.db, 'https://noctite.example/', gen)).toBeNull();
		expect(state.values).toEqual([]);
		expect(gen).toHaveBeenCalledTimes(1);
	});

	it('never overwrites an existing customized local :noctite:, and respects its later deletion', async () => {
		const original = {
			id: 'already-owned',
			name: 'noctite',
			host: null,
			originalUrl: 'https://example.org/owner.png',
			publicUrl: 'https://example.org/owner.png',
			category: 'My custom category',
			localOnly: true,
		};
		const state = makeFakeDb(original);
		const gen = vi.fn();
		expect(await seedNoctiteEmoji(state.db, 'https://noctite.example/', gen)).toBeNull();
		expect(state.values).toEqual([original]);
		expect(state.installed()).toBe(true);
		state.values.splice(0);
		expect(await seedNoctiteEmoji(state.db, 'https://noctite.example/', gen)).toBeNull();
		expect(state.values).toHaveLength(0);
		expect(state.insert).not.toHaveBeenCalled();
		expect(gen).not.toHaveBeenCalled();
	});

	it('does not confuse a remote emoji with a local emoji', async () => {
		const state = makeFakeDb({ name: 'noctite', host: 'remote.example', id: 'remote-one' });
		const result = await seedNoctiteEmoji(state.db, 'https://noctite.example/', () => 'local-one');
		expect(result).toBe('local-one');
		expect(state.values).toHaveLength(2);
		expect(state.values[1].host).toBeNull();
	});

	it('derives image URLs from configured origin, including internal test origins', async () => {
		const state = makeFakeDb();
		expect(await seedNoctiteEmoji(state.db, 'http://a.test:3000/', () => 'a-unique-id')).toBe('a-unique-id');
		expect(state.values[0].publicUrl).toBe('http://a.test:3000/static-assets/noctite-emoji.png');
	});

	it('rejects non-HTTP(S) origins before touching storage', async () => {
		const state = makeFakeDb();
		await expect(seedNoctiteEmoji(state.db, 'ftp://noctite.example/', () => 'unused'))
			.rejects.toThrow(/HTTP\(S\)/);
		expect(state.insert).not.toHaveBeenCalled();
		expect(state.db.transaction).not.toHaveBeenCalled();
	});

	it('fails startup loudly if DB insertion fails', async () => {
		const state = makeFakeDb();
		state.insert.mockRejectedValueOnce(new Error('db unavailable'));
		await expect(seedNoctiteEmoji(state.db, 'https://noctite.example/', () => 'new-id'))
			.rejects.toThrow('db unavailable');
		expect(state.installed()).toBe(false);
	});
});
