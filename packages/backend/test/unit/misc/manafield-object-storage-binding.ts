/* SPDX-License-Identifier: AGPL-3.0-only */
import { describe, expect, test } from 'vitest';
import { applyManafieldObjectStorageMetadata, assertManafieldObjectStorageTarget, readManafieldObjectStorageBinding } from '@/misc/manafield-object-storage-binding.js';
import type { MiMeta } from '@/models/Meta.js';

const managed = {
	MANAFIELD_MODULE_ID: 'noctemblith',
	MANAFIELD_BINDING_MEDIA_TARGET: 'manafield-r2',
	MANAFIELD_BINDING_MEDIA_ENDPOINT_URL: 'https://account.r2.cloudflarestorage.com',
	MANAFIELD_BINDING_MEDIA_CONFIG_BUCKET: 'manafield-storage-r2',
	MANAFIELD_BINDING_MEDIA_CONFIG_REGION: 'auto',
	MANAFIELD_BINDING_MEDIA_CONFIG_PREFIX: 'modules/noctemblith/media/',
	MANAFIELD_BINDING_MEDIA_CONFIG_FORCE_PATH_STYLE: 'true',
	MANAFIELD_BINDING_MEDIA_CONFIG_PUBLIC_BASE_URL: 'https://cdn.example.test/media',
	MANAFIELD_BINDING_MEDIA_SECRET_ACCESS_KEY_ID_FILE: '/run/manafield/bindings/media/access-key-id',
	MANAFIELD_BINDING_MEDIA_SECRET_SECRET_ACCESS_KEY_FILE: '/run/manafield/bindings/media/secret-access-key',
};

const secret = (path: string) => path.endsWith('/access-key-id') ? 'fake-access-id\n' : 'fake-secret-key\n';

describe('Manafield storage.object binding', () => {
	test('standalone mode ignores absent Manafield bindings', () => {
		expect(readManafieldObjectStorageBinding({}, () => { throw new Error('unexpected'); })).toBeNull();
	});

	test('managed mode consumes explicit S3 values and private credential files', () => {
		expect(readManafieldObjectStorageBinding(managed, secret)).toEqual({
			endpointUrl: 'https://account.r2.cloudflarestorage.com',
			bucket: 'manafield-storage-r2',
			region: 'auto',
			keyPrefix: 'modules/noctemblith/media/',
			forcePathStyle: true,
			publicBaseUrl: 'https://cdn.example.test/media',
			accessKeyId: 'fake-access-id',
			secretAccessKey: 'fake-secret-key',
		});
	});

	test('rejects missing, partial, and outside-managed-mode bindings', () => {
		expect(() => readManafieldObjectStorageBinding({ MANAFIELD_MODULE_ID: 'noctemblith' })).toThrow('TARGET');
		const { MANAFIELD_BINDING_MEDIA_CONFIG_BUCKET: _bucket, ...partial } = managed;
		expect(() => readManafieldObjectStorageBinding(partial, secret)).toThrow('CONFIG_BUCKET');
		const { MANAFIELD_MODULE_ID: _module, ...stray } = managed;
		expect(() => readManafieldObjectStorageBinding(stray, secret)).toThrow('outside managed');
	});

	test('R2 S3 API endpoint is never mistaken for a public media URL', () => {
		const { MANAFIELD_BINDING_MEDIA_CONFIG_PUBLIC_BASE_URL: _public, ...missing } = managed;
		expect(() => readManafieldObjectStorageBinding(missing, secret)).toThrow('PUBLIC_BASE_URL');
		expect(() => readManafieldObjectStorageBinding({
			...managed, MANAFIELD_BINDING_MEDIA_CONFIG_PUBLIC_BASE_URL: managed.MANAFIELD_BINDING_MEDIA_ENDPOINT_URL,
		}, secret)).toThrow('not the private S3 API');
	});

	test('rejects unsafe prefixes and unexpected bucket paths', () => {
		expect(() => readManafieldObjectStorageBinding({
			...managed, MANAFIELD_BINDING_MEDIA_CONFIG_PREFIX: '../other/',
		}, secret)).toThrow('prefix');
		expect(() => readManafieldObjectStorageBinding({
			...managed, MANAFIELD_BINDING_MEDIA_ENDPOINT_URL: 'https://account.r2.cloudflarestorage.com/manafield-storage-r2',
		}, secret)).toThrow('root HTTPS URL');
	});

	test('rejects unsafe credential paths and malformed secret files', () => {
		expect(() => readManafieldObjectStorageBinding({
			...managed, MANAFIELD_BINDING_MEDIA_SECRET_ACCESS_KEY_ID_FILE: 'relative-path',
		}, secret)).toThrow('absolute');
		expect(() => readManafieldObjectStorageBinding(managed, () => 'value\nsecond')).toThrow('malformed');
		expect(() => readManafieldObjectStorageBinding(managed, () => { throw new Error('secret file path'); })).toThrow('Cannot read');
	});

	test('overlays public runtime metadata while keeping secrets out of MiMeta and disabling R2 ACL', () => {
		const binding = readManafieldObjectStorageBinding(managed, secret)!;
		const meta = {
			useObjectStorage: false,
			objectStorageAccessKey: 'old-database-key',
			objectStorageSecretKey: 'old-database-secret',
			objectStorageSetPublicRead: true,
		} as MiMeta;
		const result = applyManafieldObjectStorageMetadata(meta, binding);
		expect(result).toBe(meta);
		expect(result.useObjectStorage).toBe(true);
		expect(result.objectStorageBucket).toBe('manafield-storage-r2');
		expect(result.objectStoragePrefix).toBe('modules/noctemblith/media');
		expect(result.objectStorageBaseUrl).toBe('https://cdn.example.test/media');
		expect(result.objectStorageSetPublicRead).toBe(false);
		expect(result.objectStorageAccessKey).toBeNull();
		expect(result.objectStorageSecretKey).toBeNull();
		expect(JSON.stringify(result)).not.toContain('fake-secret-key');
	});

	test('guards writes and deletes against crossing a bound prefix/bucket', () => {
		const binding = readManafieldObjectStorageBinding(managed, secret)!;
		expect(() => assertManafieldObjectStorageTarget(binding, 'manafield-storage-r2', 'modules/noctemblith/media/file.png')).not.toThrow();
		expect(() => assertManafieldObjectStorageTarget(binding, 'manafield-storage-r2', 'other-module/file.png')).toThrow('outside');
		expect(() => assertManafieldObjectStorageTarget(binding, 'other-bucket', 'modules/noctemblith/media/file.png')).toThrow('outside');
	});

	test('standalone Meta remains unchanged', () => {
		const meta = { useObjectStorage: false } as MiMeta;
		expect(applyManafieldObjectStorageMetadata(meta, null)).toBe(meta);
		expect(meta.useObjectStorage).toBe(false);
	});
});
