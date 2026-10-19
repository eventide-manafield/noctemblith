/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Resolve storage.object@1.0.0 from explicit Manafield Resource Binding.
 * The existing S3 client/data plane remains in Noctemblith, not Manafield Core.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { MiMeta } from '@/models/Meta.js';

const prefix = 'MANAFIELD_BINDING_MEDIA_';

export type ManafieldObjectStorageBinding = {
	endpointUrl: string;
	bucket: string;
	region: string;
	keyPrefix: string;
	forcePathStyle: boolean;
	publicBaseUrl: string;
	accessKeyId: string;
	secretAccessKey: string;
};

/** Reject missing/partial managed bindings instead of falling back to DB credentials. */
export function readManafieldObjectStorageBinding(
	env: NodeJS.ProcessEnv = process.env,
	readSecret: (filename: string) => string = filename => readFileSync(filename, 'utf8'),
): ManafieldObjectStorageBinding | null {
	const managed = env.MANAFIELD_MODULE_ID !== undefined || env.MANAFIELD_MANAGED === '1';
	const hasBinding = Object.keys(env).some(key => key.startsWith(prefix));
	if (!managed && !hasBinding) return null;
	if (!managed) throw new Error('Manafield object storage binding supplied outside managed mode');

	const required = (suffix: string): string => {
		const name = prefix + suffix;
		const value = env[name]?.trim();
		if (!value) throw new Error(`Missing required Manafield S3 binding field: ${name}`);
		return value;
	};

	required('TARGET');
	const endpointText = required('ENDPOINT_URL');
	let endpoint: URL;
	try {
		endpoint = new URL(endpointText);
	} catch {
		throw new Error('Invalid Manafield S3 endpoint URL');
	}
	if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password ||
		(endpoint.pathname !== '/' && endpoint.pathname !== '') || endpoint.search || endpoint.hash) {
		throw new Error('Manafield S3 endpoint must be a root HTTPS URL without credentials or bucket path');
	}

	const bucket = required('CONFIG_BUCKET');
	if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) {
		throw new Error('Invalid Manafield S3 bucket name');
	}
	const region = required('CONFIG_REGION');
	if (!/^[a-z0-9-]{1,40}$/.test(region)) {
		throw new Error('Invalid Manafield S3 region');
	}
	const keyPrefix = required('CONFIG_PREFIX');
	if (!/^[A-Za-z0-9_.\/-]+\/$/.test(keyPrefix) ||
		keyPrefix.startsWith('/') || keyPrefix.includes('//') ||
		keyPrefix.split('/').includes('..') || keyPrefix.split('/').includes('.')) {
		throw new Error('Invalid Manafield S3 object key prefix');
	}
	// A prefix groups keys but is NOT permission isolation. Restrict who receives
	// bucket-level credentials at deployment time.
	const style = required('CONFIG_FORCE_PATH_STYLE');
	if (style !== 'true' && style !== 'false') {
		throw new Error('Invalid Manafield S3 forcePathStyle flag');
	}

	// Noctemblith persists public Drive file URLs. An R2 S3 API URL is PRIVATE,
	// therefore a configured public media domain (custom domain or r2.dev) is
	// required to prevent creation of inaccessible Drive records.
	const publicBase = required('CONFIG_PUBLIC_BASE_URL');
	let publicUrl: URL;
	try {
		publicUrl = new URL(publicBase);
	} catch {
		throw new Error('Invalid Manafield S3 public media URL');
	}
	if (publicUrl.protocol !== 'https:' || !publicUrl.hostname || publicUrl.username || publicUrl.password ||
		publicUrl.search || publicUrl.hash || publicUrl.hostname === endpoint.hostname ||
		publicUrl.hostname.endsWith('.r2.cloudflarestorage.com')) {
		throw new Error('Manafield S3 public URL must be an accessible HTTPS media domain, not the private S3 API endpoint');
	}

	const secret = (suffix: string): string => {
		const path = required(suffix);
		if (!isAbsolute(path)) throw new Error('Manafield S3 credential file path must be absolute');
		let value: string;
		try {
			value = readSecret(path);
		} catch {
			throw new Error(`Cannot read Manafield S3 ${suffix} file`);
		}
		if (value.length > 4096) throw new Error('Manafield S3 credential file is too large');
		value = value.replace(/\r?\n$/, '');
		if (!value || /[\r\n\0]/.test(value)) {
			throw new Error('Manafield S3 credential file is empty or malformed');
		}
		return value;
	};

	return {
		endpointUrl: endpoint.origin,
		bucket,
		region,
		keyPrefix,
		forcePathStyle: style === 'true',
		publicBaseUrl: publicUrl.toString().replace(/\/+$/, ''),
		accessKeyId: secret('SECRET_ACCESS_KEY_ID_FILE'),
		secretAccessKey: secret('SECRET_SECRET_ACCESS_KEY_FILE'),
	};
}

export const manafieldManagedStorageMetaKeys = [
	'useObjectStorage',
	'objectStorageBucket',
	'objectStoragePrefix',
	'objectStorageBaseUrl',
	'objectStorageEndpoint',
	'objectStorageRegion',
	'objectStoragePort',
	'objectStorageAccessKey',
	'objectStorageSecretKey',
	'objectStorageUseSSL',
	'objectStorageUseProxy',
	'objectStorageSetPublicRead',
	'objectStorageS3ForcePathStyle',
] as const satisfies readonly (keyof MiMeta)[];

/** Protect application writes/deletes even when the S3 key has broad bucket access.
 * This is defense in depth, NOT a substitute for IAM/bucket access policies. */
export function assertManafieldObjectStorageTarget(
	binding: ManafieldObjectStorageBinding | null,
	bucket: string | undefined,
	key: string | undefined,
): void {
	if (!binding) return;
	if (bucket !== binding.bucket || !key?.startsWith(binding.keyPrefix)) {
		throw new Error('S3 operation is outside the managed Manafield Storage Binding');
	}
}

/** Apply only public metadata to runtime settings: NEVER store S3 keys in Meta. */
export function applyManafieldObjectStorageMetadata(
	meta: MiMeta,
	binding: ManafieldObjectStorageBinding | null,
): MiMeta {
	if (!binding) return meta;
	const endpoint = new URL(binding.endpointUrl);
	Object.assign(meta, {
		useObjectStorage: true,
		objectStorageBucket: binding.bucket,
		objectStoragePrefix: binding.keyPrefix.replace(/\/$/, ''),
		objectStorageBaseUrl: binding.publicBaseUrl,
		objectStorageEndpoint: endpoint.host,
		objectStoragePort: endpoint.port ? Number(endpoint.port) : null,
		objectStorageRegion: binding.region,
		objectStorageUseSSL: true,
		objectStorageSetPublicRead: false, // R2 does not support S3 public-read ACLs.
		objectStorageS3ForcePathStyle: binding.forcePathStyle,
		objectStorageAccessKey: null,
		objectStorageSecretKey: null,
	});
	return meta;
}
