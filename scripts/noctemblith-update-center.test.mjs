/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Run with Node 22+:
 *   node --experimental-strip-types --test scripts/noctemblith-update-center.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	checkForUpdates,
	parseSubscription,
	RELEASE_CHANNEL,
	DEV_CHANNEL,
	chooseUpdate,
	isBuildMetadata,
	parseLatestSuccessfulRun,
	shouldNotify,
	readDecision,
	saveDecision,
} from '../packages/frontend/src/studio/manafield/eventide/noctemblith-updates.ts';

const oldSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const makeRun = (sha, branch = 'noctemblith/dev') => ({
	head_sha: sha,
	head_branch: branch,
	conclusion: 'success',
	html_url: 'https://github.com/eventide-manafield/noctemblith/actions/runs/1234',
});
const goodResponse = data => ({ ok: true, json: async () => data });

test('verified release results exclude other channels and malformed builds', () => {
	const result = parseLatestSuccessfulRun({
		workflow_runs: [
			makeRun('invalid'),
			makeRun(nextSha, 'noctemblith/1.0.0'),
			makeRun(nextSha),
		],
	}, 'noctemblith/dev');
	assert.equal(result.sha, nextSha);
	assert.equal(result.channel, 'noctemblith/dev');
	assert.equal(parseLatestSuccessfulRun({ workflow_runs: [] }, 'noctemblith/dev'), null);
});

test('current build metadata must include a full SHA and Noctemblith channel', () => {
	assert.equal(isBuildMetadata({ sha: oldSha, channel: 'noctemblith/dev' }), true);
	assert.equal(isBuildMetadata({ sha: 'unknown', channel: 'noctemblith/dev' }), false);
	assert.equal(isBuildMetadata({ sha: oldSha, channel: 'develop' }), false);
});

test('an update only appears when a successful channel build is ahead of installed SHA', async () => {
	const originalFetch = globalThis.fetch;
	const urls = [];
	globalThis.fetch = async (url, options) => {
		urls.push(String(url));
		if (urls.length === 1) {
			assert.equal(options.credentials, 'same-origin');
			return goodResponse({ sha: oldSha, channel: 'noctemblith/dev' });
		}
		if (urls.length === 2) {
			assert.equal(options.credentials, 'omit');
			return goodResponse({ workflow_runs: [makeRun(nextSha)] });
		}
		return goodResponse({ status: 'ahead' });
	};
	try {
		const result = await checkForUpdates(DEV_CHANNEL);
		assert.equal(result.state, 'available');
		assert.equal(result.candidate.sha, nextSha);
		assert.ok(urls[1].includes('branch=noctemblith%2Fdev'));
		assert.ok(urls[2].endsWith(oldSha + '...' + nextSha));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('older, diverged and equal build results never trigger an update', async () => {
	const originalFetch = globalThis.fetch;
	try {
		for (const comparison of ['behind', 'diverged', 'identical']) {
			let count = 0;
			globalThis.fetch = async () => {
				count++;
				if (count === 1) return goodResponse({ sha: oldSha, channel: 'noctemblith/dev' });
				if (count === 2) return goodResponse({ workflow_runs: [makeRun(nextSha)] });
				return goodResponse({ status: comparison });
			};
			assert.equal((await checkForUpdates(DEV_CHANNEL)).state, 'current');
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('skip and snooze are separate decisions tied to an exact candidate SHA', () => {
	const candidate = { sha: nextSha, channel: 'noctemblith/dev', workflowUrl: makeRun(nextSha).html_url };
	const now = 1234567000;
	const skipped = chooseUpdate({}, nextSha, 'skip', now);
	assert.equal(shouldNotify(candidate, skipped, now), false);
	assert.equal(shouldNotify({ ...candidate, sha: oldSha }, skipped, now), true);

	const snoozed = chooseUpdate({}, nextSha, 'snooze', now);
	assert.equal(shouldNotify(candidate, snoozed, now + 6 * 86400000), false);
	assert.equal(shouldNotify(candidate, snoozed, now + 7 * 86400000), true);
	assert.equal(shouldNotify({ ...candidate, sha: oldSha }, snoozed, now), true);
});

test('skip and snooze decisions persist per admin in browser storage', () => {
	const original = globalThis.localStorage;
	const values = new Map();
	globalThis.localStorage = {
		getItem: key => values.get(key) ?? null,
		setItem: (key, value) => { values.set(key, value); },
	};
	try {
		saveDecision('one', chooseUpdate({}, nextSha, 'skip'));
		assert.equal(readDecision('one').skippedSha, nextSha);
		assert.deepEqual(readDecision('another-admin'), {});
		assert.ok([...values.keys()][0].includes('studio.manafield.eventide'));
	} finally {
		globalThis.localStorage = original;
	}
});

test('old images without build metadata are shown as untracked, without public GitHub requests', async () => {
	const original = globalThis.fetch;
	const urls = [];
	globalThis.fetch = async url => {
		urls.push(String(url));
		return { ok: false, status: 404 };
	};
	try {
		assert.equal((await checkForUpdates()).state, 'untracked');
		assert.deepEqual(urls, ['/noctemblith-build.json']);
	} finally {
		globalThis.fetch = original;
	}
});

test('UI buttons are real controls but do not grant Docker or host execution privileges', () => {
	const ui = readFileSync(new URL('../packages/frontend/src/studio/manafield/eventide/NoctemblithUpdatePanel.vue', import.meta.url), 'utf8');
	const nav = readFileSync(new URL('../packages/frontend/src/pages/admin/index.vue', import.meta.url), 'utf8');
	const router = readFileSync(new URL('../packages/frontend/src/router.definition.ts', import.meta.url), 'utf8');
	const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
	const workflow = readFileSync(new URL('../.github/workflows/docker.yml', import.meta.url), 'utf8');

	for (const callback of ['@click="requestGuide"', '@click="skip"', '@click="snooze"']) assert.ok(ui.includes(callback));
	assert.ok(ui.includes('수동 배포'));
	assert.ok(nav.includes('NoctemblithUpdatePanel'));
	assert.ok(router.includes('/noctemblith-updates'));
	assert.ok(docker.includes('NOCTEMBLITH_BUILD_SHA'));
	assert.ok(docker.includes('--from=native-builder /misskey/packages/backend/assets/noctemblith-build.json'));
	assert.ok(workflow.includes('NOCTEMBLITH_UPDATE_CHANNEL='));
	assert.doesNotMatch(ui, /docker\.sock|child_process|execSync|spawn\(/);
});

test('stamped image build metadata is strict JSON and is never cached by the app', () => {
	const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
	const match = docker.match(/^RUN (printf .*?) > packages\/backend\/assets\/noctemblith-build\.json$/m);
	assert.ok(match, 'Dockerfile must stamp metadata during image build');
	const generated = execFileSync('sh', ['-c', match[1]], {
		encoding: 'utf8',
		env: { ...process.env, NOCTEMBLITH_BUILD_SHA: oldSha, NOCTEMBLITH_UPDATE_CHANNEL: 'noctemblith/dev' },
	});
	assert.deepEqual(JSON.parse(generated), { sha: oldSha, channel: 'noctemblith/dev' });
	const server = readFileSync(new URL('../packages/backend/src/server/web/ClientServerService.ts', import.meta.url), 'utf8');
	assert.match(server, /reply\.header\('Cache-Control', 'no-store'\)/);
	assert.match(server, /reply\.sendFile\('\/noctemblith-build\.json', this\.staticAssets, \{ cacheControl: false \}\)/);
});

test('update center Korean copy uses polite user-facing language', () => {
	const panel = readFileSync(new URL('../packages/frontend/src/studio/manafield/eventide/NoctemblithUpdatePanel.vue', import.meta.url), 'utf8');
	const messages = readFileSync(new URL('../packages/frontend/src/studio/manafield/eventide/noctemblith-updates.ts', import.meta.url), 'utf8');
	for (const source of [panel, messages]) {
		assert.doesNotMatch(source, /(?:중이야|준비되었어|할 수 있어|확인해줘|교체해줘|찾지 못했어|사용 중이야|가져오지 못했어|변경하지 않아|사용해야 해|정보를 확인할 수 없어)/);
	}
	assert.match(panel, /업데이트 정보를 확인하는 중입니다/);
	assert.match(messages, /빌드 정보를 확인할 수 없습니다/);
});

test('release subscription is default, development requires explicit selection', async () => {
	assert.equal(parseSubscription(undefined), RELEASE_CHANNEL);
	assert.equal(parseSubscription('noctemblith/other'), RELEASE_CHANNEL);
	assert.equal(parseSubscription(DEV_CHANNEL), DEV_CHANNEL);
	const originalFetch = globalThis.fetch;
	const urls = [];
	globalThis.fetch = async (url) => {
		urls.push(String(url));
		if (urls.length === 1) return goodResponse({ sha: oldSha, channel: DEV_CHANNEL });
		return goodResponse({ workflow_runs: [makeRun(nextSha, DEV_CHANNEL)] });
	};
	try {
		const result = await checkForUpdates();
		assert.equal(result.state, 'current');
		assert.ok(urls[1].includes('branch=noctemblith%2Frelease%2Flatest'));
		assert.equal(urls.length, 2, 'default subscription must not query dev branch');
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('server-level subscription and dev warning are wired in UI and backend', () => {
	const panel = readFileSync(new URL('../packages/frontend/src/studio/manafield/eventide/NoctemblithUpdatePanel.vue', import.meta.url), 'utf8');
	const meta = readFileSync(new URL('../packages/backend/src/server/api/endpoints/admin/meta.ts', import.meta.url), 'utf8');
	const update = readFileSync(new URL('../packages/backend/src/server/api/endpoints/admin/update-meta.ts', import.meta.url), 'utf8');
	const entity = readFileSync(new URL('../packages/backend/src/models/Meta.ts', import.meta.url), 'utf8');
	const migration = readFileSync(new URL('../packages/backend/migration/1792000000000-NoctiteUpdateSubscription.js', import.meta.url), 'utf8');
	assert.match(panel, /misskeyApi\('admin\/meta'\)/);
	assert.match(panel, /misskeyApi\('admin\/update-meta'/);
	assert.match(panel, /v-model="showDev"/);
	assert.match(panel, /status\.value\.candidate\.channel === DEV_CHANNEL/);
	assert.match(panel, /:disabled="!devRiskAccepted"/);
	assert.match(panel, /개발 버전의 안정성과 이전 버전으로의 복구는 보장되지 않습니다/);
	assert.match(meta, /noctemblithUpdateChannel: instance\.noctemblithUpdateChannel/);
	assert.match(update, /set\.noctemblithUpdateChannel = ps\.noctemblithUpdateChannel/);
	assert.match(entity, /default: 'noctemblith\/release\/latest'/);
	assert.match(migration, /ALTER TABLE "meta" ADD "noctiteUpdateChannel"/);
	const brandMigration = readFileSync(new URL('../packages/backend/migration/1792000000004-NoctemblithUpdateChannelColumn.js', import.meta.url), 'utf8');
	assert.match(brandMigration, /RENAME COLUMN "noctiteUpdateChannel" TO "noctemblithUpdateChannel"/);
	assert.doesNotMatch(panel, /docker\.sock|child_process|execSync|spawn\(/);
});

test('Noctemblith endpoints and metadata do not expose the retired name', () => {
	const web = readFileSync(new URL('../packages/backend/src/server/web/ClientServerService.ts', import.meta.url), 'utf8');
	assert.match(web, /fastify\.get\('\/noctemblith-build\.json'/);
	assert.doesNotMatch(web, /fastify\.get\('\/noctite-build\.json'/);
	const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
	assert.match(docker, /assets\/noctemblith-build\.json/);
	assert.doesNotMatch(docker, /assets\/noctite-build\.json/);
	const router = readFileSync(new URL('../packages/frontend/src/router.definition.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(router, /path: '\/noctite-updates'/);
});
test('new development domain has a separate Compose/Traefik identity', () => {
	const compose = readFileSync(new URL('../deploy/manafield/compose.noctemblith-dev.candidate.yml', import.meta.url), 'utf8');
	const router = readFileSync(new URL('../deploy/manafield/traefik.noctemblith-dev.candidate.yml', import.meta.url), 'utf8');
	assert.match(compose, /name: noctemblith-dev/);
	assert.match(compose, /noctemblith-postgres:/);
	assert.match(compose, /noctemblith-redis:/);
	assert.match(compose, /noctemblith-media:/);
	assert.match(router, /noctemblith-dev\.manafield\.studio/);
});
