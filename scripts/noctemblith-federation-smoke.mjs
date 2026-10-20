#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Read-only HTTP discovery checks. This is NOT a test of signed inbox
 * delivery, cross-server following, federation moderation, or retries.
 */

const [originArg, usernameArg] = process.argv.slice(2);
if (process.argv.length !== 4) {
	console.error('Usage: node scripts/noctemblith-federation-smoke.mjs https://INSTANCE.EXAMPLE USERNAME');
	process.exitCode = 2;
} else {
	await main(originArg, usernameArg).catch((error) => {
		console.error('FAIL:', error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}

async function main(originArg, username) {
	const root = new URL(originArg);
	if (root.protocol !== 'https:' || root.username || root.password ||
		root.pathname !== '/' || root.search || root.hash ||
		!root.hostname || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) {
		throw new Error('Expected a public HTTPS origin and one local username');
	}
	const base = root.origin;
	const resource = 'acct:' + username + '@' + root.host;

	const health = await get(new URL('/healthz/', base));
	if (health.status !== 200) throw new Error('/healthz/ returned ' + health.status);
	console.log('PASS /healthz/: HTTP 200');

	const nodeinfo = await getJson(new URL('/.well-known/nodeinfo', base), 'application/json');
	if (!Array.isArray(nodeinfo.links) || !nodeinfo.links.some(link =>
		typeof link.rel === 'string' && link.rel.includes('nodeinfo.diaspora.software/ns/schema/2.') &&
		typeof link.href === 'string' && link.href.startsWith(base + '/'))) {
		throw new Error('NodeInfo discovery lacks a same-origin NodeInfo 2.x link');
	}
	console.log('PASS NodeInfo discovery');

	const fingerUrl = new URL('/.well-known/webfinger', base);
	fingerUrl.searchParams.set('resource', resource);
	const finger = await getJson(fingerUrl, 'application/jrd+json');
	if (finger.subject !== resource || !Array.isArray(finger.links)) {
		throw new Error('WebFinger subject/links do not match expected account');
	}
	const link = finger.links.find(link => link.rel === 'self' &&
		typeof link.href === 'string' && typeof link.type === 'string' &&
		(link.type.includes('activity+json') || link.type.includes('activitystreams')));
	if (!link) throw new Error('WebFinger has no ActivityPub actor self link');
	const actorUrl = new URL(link.href);
	if (actorUrl.origin !== base || actorUrl.protocol !== 'https:') {
		throw new Error('WebFinger actor URL is not on the Noctemblith origin');
	}
	console.log('PASS WebFinger actor discovery');

	const actor = await getJson(actorUrl, 'application/activity+json');
	if (!['Person', 'Service', 'Group', 'Organization', 'Application'].includes(actor.type) ||
		typeof actor.id !== 'string' || actor.id !== link.href ||
		typeof actor.inbox !== 'string' || !actor.inbox.startsWith(base + '/') ||
		typeof actor.outbox !== 'string' || !actor.outbox.startsWith(base + '/') ||
		typeof actor.publicKey?.publicKeyPem !== 'string') {
		throw new Error('ActivityPub actor missing expected inbox, outbox, key or identity');
	}
	console.log('PASS ActivityPub actor: ID, inbox, outbox, public key');
	console.log('Discovery checks pass. Test signed federation between two real servers next.');
}

async function get(url, accept) {
	const response = await fetch(url, {
		headers: accept ? { Accept: accept } : undefined,
		redirect: 'manual',
		signal: AbortSignal.timeout(10_000),
	});
	if (response.status >= 300 && response.status < 400) {
		throw new Error('Unexpected redirect at ' + url.pathname);
	}
	return response;
}

async function getJson(url, accept) {
	const response = await get(url, accept);
	if (response.status !== 200) throw new Error(url.pathname + ' returned ' + response.status);
	const type = response.headers.get('content-type') ?? '';
	if (!type.includes('json')) throw new Error(url.pathname + ': expected JSON, got ' + type);
	return response.json();
}
