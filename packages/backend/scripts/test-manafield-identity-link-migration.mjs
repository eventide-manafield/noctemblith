/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Run only against the disposable PostgreSQL service in CI. No production DB
 * connection string is accepted: queries execute exclusively in that container.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ManafieldIdentityLink1792000000004 } from '../migration/1792000000004-ManafieldIdentityLink.js';

const containerId = process.env.PG_SERVICE_CONTAINER_ID;
if (typeof containerId !== 'string' || !/^[a-f0-9]{12,64}$/.test(containerId)) {
	throw new Error('Expected an explicit disposable CI PostgreSQL container ID');
}

function sql(query) {
	return execFileSync('docker', [
		'exec', '-i', containerId, 'psql',
		'-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
		'-U', 'noct_test', '-d', 'noct_test', '-c', query,
	], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function mustReject(statement, explanation) {
	try {
		sql(statement);
	} catch {
		return;
	}
	assert.fail(explanation);
}

const migration = new ManafieldIdentityLink1792000000004();
const runner = { query: async statement => sql(statement) };
sql('CREATE TABLE "user" ("id" varchar(32) PRIMARY KEY, "host" varchar(128) NULL)');
sql("INSERT INTO \"user\" (\"id\", \"host\") VALUES ('local_one', NULL), ('local_two', NULL), ('remote_actor', 'remote.example')");
await migration.up(runner);

const one = '00000000-0000-4000-8000-000000000001';
const two = '00000000-0000-4000-8000-000000000002';
const three = '00000000-0000-4000-8000-000000000003';
sql(`INSERT INTO "manafield_identity_link" ("providerId","subjectUuid","userId")
 VALUES ('manafield-account','${one}','local_one')`);
assert.equal(sql(`SELECT "userId" FROM "manafield_identity_link"
 WHERE "providerId"='manafield-account' AND "subjectUuid"='${one}'`), 'local_one');

mustReject(`INSERT INTO "manafield_identity_link" ("providerId","subjectUuid","userId")
 VALUES ('manafield-account','${one}','local_two')`, 'duplicate subject linked to another user');
mustReject(`INSERT INTO "manafield_identity_link" ("providerId","subjectUuid","userId")
 VALUES ('manafield-account','${two}','local_one')`, 'local user linked to two subjects');
mustReject(`INSERT INTO "manafield_identity_link" ("providerId","subjectUuid","userId")
 VALUES ('manafield-account','${two}','remote_actor')`, 'remote ActivityPub actor accepted');
mustReject(`INSERT INTO "manafield_identity_link" ("providerId","subjectUuid","userId")
 VALUES ('manafield-account','${two}','missing_user')`, 'nonexistent local user accepted');
mustReject(`INSERT INTO "manafield_identity_link" ("providerId","subjectUuid","userId")
 VALUES ('invalid provider','${three}','local_two')`, 'invalid provider identifier accepted');
mustReject(`UPDATE "manafield_identity_link" SET "subjectUuid"='${two}'
 WHERE "providerId"='manafield-account' AND "subjectUuid"='${one}'`, 'existing mapping was mutable');

sql("DELETE FROM \"user\" WHERE \"id\"='local_one'");
assert.equal(sql('SELECT count(*) FROM "manafield_identity_link"'), '0', 'deleted user link was not removed');
await migration.down(runner);
assert.equal(sql("SELECT to_regclass('public.manafield_identity_link') IS NULL"), 't', 'down migration did not drop table');
console.log('Manafield UUID mapping migration: all disposable PostgreSQL checks passed');
