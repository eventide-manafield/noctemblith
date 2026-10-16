/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { readManafieldDatabaseBinding } from '@/misc/manafield-database-binding.js';

const managed = {
	MANAFIELD_MODULE_ID: 'noctemblith-service',
	MANAFIELD_BINDING_STATE_TARGET: 'main-postgres',
	MANAFIELD_BINDING_STATE_ENDPOINT_HOST: 'manafield-postgres',
	MANAFIELD_BINDING_STATE_ENDPOINT_PORT: '5432',
	MANAFIELD_BINDING_STATE_CONFIG_DATABASE: 'manafield',
	MANAFIELD_BINDING_STATE_CONFIG_USERNAME: 'mf_noctemblith_service_state',
	MANAFIELD_BINDING_STATE_CONFIG_SCHEMA: 'mf_noctemblith_service_state',
	MANAFIELD_BINDING_STATE_SECRET_PASSWORD_FILE: '/run/manafield/bindings/state/password',
};

describe('Manafield PostgreSQL binding', () => {
	test('does not affect standalone execution', () => {
		expect(readManafieldDatabaseBinding({}, () => { throw new Error('must not read'); })).toBeNull();
	});

	test('resolves the explicit target and reads the mounted secret', () => {
		expect(readManafieldDatabaseBinding(managed, () => 'test-password\n')).toEqual({
			host: 'manafield-postgres',
			port: 5432,
			db: 'manafield',
			user: 'mf_noctemblith_service_state',
			pass: 'test-password',
			schema: 'mf_noctemblith_service_state',
		});
	});

	test('rejects managed mode without a binding instead of using standalone DB', () => {
		expect(() => readManafieldDatabaseBinding({ MANAFIELD_MODULE_ID: 'noctemblith-service' })).toThrow('TARGET');
	});

	test('rejects partial bindings', () => {
		const { MANAFIELD_BINDING_STATE_CONFIG_DATABASE: _database, ...incomplete } = managed;
		expect(() => readManafieldDatabaseBinding(incomplete)).toThrow('CONFIG_DATABASE');
	});

	test('rejects binding values sent outside managed mode', () => {
		const { MANAFIELD_MODULE_ID: _module, ...unmanaged } = managed;
		expect(() => readManafieldDatabaseBinding(unmanaged)).toThrow('outside Manafield managed mode');
	});

	test('rejects invalid ports and schema names', () => {
		expect(() => readManafieldDatabaseBinding({ ...managed, MANAFIELD_BINDING_STATE_ENDPOINT_PORT: '99999' })).toThrow('port');
		expect(() => readManafieldDatabaseBinding({ ...managed, MANAFIELD_BINDING_STATE_CONFIG_SCHEMA: 'public;DROP' })).toThrow('schema');
	});

	test('requires a readable, nonempty file without disclosing secrets', () => {
		expect(() => readManafieldDatabaseBinding({ ...managed, MANAFIELD_BINDING_STATE_SECRET_PASSWORD_FILE: 'relative' })).toThrow('absolute');
		expect(() => readManafieldDatabaseBinding(managed, () => { throw new Error('private path'); })).toThrow('Cannot read');
		expect(() => readManafieldDatabaseBinding(managed, () => '\n')).toThrow('empty or malformed');
		expect(() => readManafieldDatabaseBinding(managed, () => 'first\nsecond')).toThrow('empty or malformed');
	});
});
