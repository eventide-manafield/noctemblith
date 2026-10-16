/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * New installs use one PostgreSQL-18 baseline derived from all historical
 * migrations. No existing database or schema is dropped automatically.
 */

import { readFileSync } from 'node:fs';

export class NoctemblithBaseline1792170000000 {
	name = 'NoctemblithBaseline1792170000000';

	async up(queryRunner) {
		const schema = queryRunner.connection.options.schema
			?? (await queryRunner.query('SELECT current_schema() AS schema'))[0]?.schema;
		if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
			throw new Error('Noctemblith DB schema must be a valid lowercase PostgreSQL identifier');
		}
		const template = readFileSync(new URL('./initial-baseline.sql', import.meta.url), 'utf8');
		const sql = template.replaceAll('__MANAFIELD_SCHEMA__', `"${schema}"`);
		await queryRunner.query(sql);
	}

	async down() {
		// Never drop a shared schema or its objects through a generic migration rollback.
		throw new Error('Noctemblith baseline rollback is not automatic; use an isolated disposable database reset');
	}
}
