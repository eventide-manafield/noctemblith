/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Read-only S3 readiness check using the SAME AWS SDK as Noctemblith.
 * Example: sudo node packages/backend/scripts/check_manafield_s3_readonly.mjs
 *   /opt/manafield/ai-workspace/instance manafield-r2
 *
 * No writes, deletes, credentials or object key names are output.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const root = process.argv[2] ?? '/opt/manafield/ai-workspace/instance';
const id = process.argv[3] ?? 'manafield-r2';
if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(id) || id.includes('..')) {
	console.error('FAIL: invalid S3 Resource ID');
	process.exit(2);
}

function readCredential(filename) {
	const file = path.join(root, 'secrets', 's3', id, filename);
	const meta = fs.lstatSync(file);
	if (!meta.isFile() || meta.isSymbolicLink() || meta.size === 0 || meta.size > 4096) {
		throw new Error('Invalid private S3 credential file');
	}
	const value = fs.readFileSync(file, 'utf8').replace(/\r?\n$/, '');
	if (!value || /[\r\n\0]/.test(value)) throw new Error('Malformed private S3 credential file');
	return value;
}

let client;
try {
	const config = loadYaml(fs.readFileSync(path.join(root, 'instance.yaml'), 'utf8'));
	const selected = (config.resources ?? []).filter(resource => resource.id === id);
	if (selected.length !== 1 || selected[0].provider !== 's3') {
		throw new Error('Resource is not a unique S3 Resource');
	}
	const { endpoint, bucket, region = 'auto', forcePathStyle = true } = selected[0].config ?? {};
	const u = new URL(endpoint);
	if (u.protocol !== 'https:' || !u.hostname || u.pathname !== '/' || u.search || u.hash || u.username || u.password) {
		throw new Error('Malformed S3 Resource HTTPS endpoint');
	}
	if (typeof bucket !== 'string' || !bucket) throw new Error('S3 bucket is missing');
	client = new S3Client({
		endpoint: u.origin,
		region,
		forcePathStyle,
		credentials: {
			accessKeyId: readCredential('access-key-id'),
			secretAccessKey: readCredential('secret-access-key'),
		},
		maxAttempts: 2,
	});
	// The bucket list returns object keys, but these are deliberately discarded.
	await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }), {
		abortSignal: AbortSignal.timeout(15000),
	});
	console.log('PASS: authenticated read-only S3 ListObjectsV2 against the configured R2 bucket');
	if (!selected[0].config.publicBaseUrl) {
		console.log('NEXT: publicBaseUrl is not configured; Noctemblith public media delivery is not ready');
	}
} catch (e) {
	// Only a generic error category/status: NEVER serialize credentials,
	// HTTP responses, bucket object keys, or raw error messages.
	const safeNames = new Set(['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket',
		'TimeoutError', 'AbortError', 'CredentialsProviderError', 'NetworkingError']);
	const category = safeNames.has(e?.name) ? e.name : 'ConfigurationOrConnectionFailure';
	const status = Number.isInteger(e?.$metadata?.httpStatusCode) ? e.$metadata.httpStatusCode : 'unknown';
	console.error(`FAIL: R2 authenticated bucket check (${category}; HTTP ${status})`);
	process.exitCode = 1;
} finally {
	client?.destroy();
}
