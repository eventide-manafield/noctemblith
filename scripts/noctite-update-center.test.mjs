/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Run with Node 22+:
 *   node --experimental-strip-types --test scripts/noctite-update-center.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	checkForUpdates,
	chooseUpdate,
	isBuildMetadata,
	parseLatestSuccessfulRun,
	shouldNotify,
	readDecision,
	saveDecision,
} from '../packages/frontend/src/studio/manafield/eventide/noctite-updates.ts';

const oldSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const makeRun = (sha, branch = 'noctite/dev') => ({
	head_sha: sha,
	head_branch: branch,
	conclusion: 'success',
	html_url: 'https://github.com/eventide-manafield/noctite/actions/runs/1234',
});
const goodResponse = data => ({ ok: true, json: async () => data });

test('verified release results exclude other channels and malformed builds', () => {
	const result = parseLatestSuccessfulRun({
		workflow_runs: [
			makeRun('invalid'),
			makeRun(nextSha, 'noctite/1.0.0'),
			makeRun(nextSha),
		],
	}, 'noctite/dev');
	assert.equal(result.sha, nextSha);
	assert.equal(result.channel, 'noctite/dev');
	assert.equal(parseLatestSuccessfulRun({ workflow_runs: [] }, 'noctite/dev'), null);
});

test('current build metadata must include a full SHA and Noctite channel', () => {
	assert.equal(isBuildMetadata({ sha: oldSha, channel: 'noctite/dev' }), true);
	assert.equal(isBuildMetadata({ sha: 'unknown', channel: 'noctite/dev' }), false);
	assert.equal(isBuildMetadata({ sha: oldSha, channel: 'develop' }), false);
});

test('an update only appears when a successful channel build is ahead of installed SHA', async () => {
	const originalFetch = globalThis.fetch;
	const urls = [];
	globalThis.fetch = async (url, options) => {
		urls.push(String(url));
		if (urls.length === 1) {
			assert.equal(options.credentials, 'same-origin');
			return goodResponse({ sha: oldSha, channel: 'noctite/dev' });
		}
		if (urls.length === 2) {
			assert.equal(options.credentials, 'omit');
			return goodResponse({ workflow_runs: [makeRun(nextSha)] });
		}
		return goodResponse({ status: 'ahead' });
	};
	try {
		const result = await checkForUpdates();
		assert.equal(result.state, 'available');
		assert.equal(result.candidate.sha, nextSha);
		assert.ok(urls[1].includes('branch=noctite%2Fdev'));
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
				if (count === 1) return goodResponse({ sha: oldSha, channel: 'noctite/dev' });
				if (count === 2) return goodResponse({ workflow_runs: [makeRun(nextSha)] });
				return goodResponse({ status: comparison });
			};
			assert.equal((await checkForUpdates()).state, 'current');
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('skip and snooze are separate decisions tied to an exact candidate SHA', () => {
	const candidate = { sha: nextSha, channel: 'noctite/dev', workflowUrl: makeRun(nextSha).html_url };
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
		assert.deepEqual(urls, ['/noctite-build.json']);
	} finally {
		globalThis.fetch = original;
	}
});

test('UI buttons are real controls but do not grant Docker or host execution privileges', () => {
	const ui = readFileSync(new URL('../packages/frontend/src/studio/manafield/eventide/NoctiteUpdatePanel.vue', import.meta.url), 'utf8');
	const nav = readFileSync(new URL('../packages/frontend/src/pages/admin/index.vue', import.meta.url), 'utf8');
	const router = readFileSync(new URL('../packages/frontend/src/router.definition.ts', import.meta.url), 'utf8');
	const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
	const workflow = readFileSync(new URL('../.github/workflows/docker.yml', import.meta.url), 'utf8');

	for (const callback of ['@click="showGuide', '@click="skip"', '@click="snooze"']) assert.ok(ui.includes(callback));
	assert.ok(ui.includes('수동 배포'));
	assert.ok(nav.includes('NoctiteUpdatePanel'));
	assert.ok(router.includes('/noctite-updates'));
	assert.ok(docker.includes('NOCTITE_BUILD_SHA'));
	assert.ok(docker.includes('--from=native-builder /misskey/packages/backend/assets/noctite-build.json'));
	assert.ok(workflow.includes('NOCTITE_UPDATE_CHANNEL='));
	assert.doesNotMatch(ui, /docker\.sock|child_process|execSync|spawn\(/);
});
