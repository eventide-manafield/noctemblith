/* No external dependencies: node --test scripts/test-schema-baseline.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NoctemblithBaseline1792170000000 } from '../migration/1792170000000-NoctemblithBaseline.js';

const migration = new NoctemblithBaseline1792170000000();

async function generate(options, currentSchema = 'public') {
  let statements = '';
  const runner = {
    connection: { options },
    async query(sql) {
      if (sql.startsWith('SELECT current_schema()')) return [{schema: currentSchema}];
      statements += sql;
      return [];
    },
  };
  await migration.up(runner);
  return statements;
}

test('uses an explicitly configured PostgreSQL schema in every qualified object', async () => {
  const sql = await generate({schema: 'mf_noctemblith'});
  assert.match(sql, /CREATE TABLE "mf_noctemblith"\."user"/);
  assert.match(sql, /CREATE FUNCTION "mf_noctemblith"\./);
  assert.doesNotMatch(sql, /public\./);
  assert.doesNotMatch(sql, /CREATE SCHEMA public;/);
});

test('inherits role current_schema when standalone schema is not configured', async () => {
  const sql = await generate({}, 'standalone_app');
  assert.match(sql, /CREATE TABLE "standalone_app"\."user"/);
});

test('rejects unsafe identifiers before SQL generation', async () => {
  await assert.rejects(() => generate({schema: 'foo; DROP SCHEMA public CASCADE'}), /valid lowercase/);
  await assert.rejects(() => generate({schema: 'A-MixedCase'}), /valid lowercase/);
});

test('does not allow destructive automatic baseline rollback', async () => {
  await assert.rejects(() => migration.down(), /not automatic/);
});
