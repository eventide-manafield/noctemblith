/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Explicit opt-in R2 delivery smoke test for one unique disposable object.
 * This script does WRITE and DELETE its own test object; it is never executed
 * by CI or by an unattended Manafield service.
 *
 * sudo node packages/backend/scripts/check_manafield_s3_public_delivery.mjs \
 *   /opt/manafield/ai-workspace/instance manafield-r2 --write-temporary-object
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { load as parseYaml } from 'js-yaml';
import {
  S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
} from '@aws-sdk/client-s3';

const root = process.argv[2];
const resourceId = process.argv[3];
const consent = process.argv[4];
if (!root || !resourceId || consent !== '--write-temporary-object' || process.argv.length !== 5) {
  console.error('Usage: sudo node check_manafield_s3_public_delivery.mjs INSTANCE_ROOT RESOURCE_ID --write-temporary-object');
  process.exit(2);
}
if (!path.isAbsolute(root) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(resourceId) || resourceId.includes('..')) {
  console.error('Invalid Instance root or S3 Resource ID');
  process.exit(2);
}

const loadCredential = filename => {
  const filenameOnDisk = path.join(root, 'secrets', 's3', resourceId, filename);
  const stat = fs.lstatSync(filenameOnDisk);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4096) {
    throw new Error('Invalid credential file');
  }
  const content = fs.readFileSync(filenameOnDisk, 'utf8').replace(/\r?\n$/, '');
  if (!content || /[\r\n\0]/.test(content)) throw new Error('Invalid credential format');
  return content;
};

const failSafe = err => {
  const allowed = new Set([
    'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'NoSuchBucket',
    'NotFound', 'TimeoutError', 'AbortError',
  ]);
  const kind = allowed.has(err?.name) ? err.name : 'ConnectionOrDeliveryFailure';
  const code = Number.isInteger(err?.$metadata?.httpStatusCode) ? err.$metadata.httpStatusCode : 'unknown';
  console.error(`FAIL: S3 public delivery check (${kind}; HTTP ${code})`);
};

let client;
let bucket;
let key;
let created = false;
let result = 1;
try {
  const definition = parseYaml(fs.readFileSync(path.join(root, 'instance.yaml'), 'utf8'));
  const matched = (definition.resources ?? []).filter(item => item.id === resourceId);
  if (matched.length !== 1 || matched[0].provider !== 's3') throw new Error('Missing or duplicate S3 Resource');
  const config = matched[0].config;
  if (!config || typeof config !== 'object') throw new Error('Missing S3 Resource config');
  bucket = config.bucket;
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid bucket');
  const endpoint = new URL(config.endpoint);
  const publicBase = new URL(config.publicBaseUrl);
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
      endpoint.username || endpoint.password || !endpoint.hostname ||
      publicBase.protocol !== 'https:' || publicBase.search || publicBase.hash ||
      publicBase.username || publicBase.password || !publicBase.hostname ||
      publicBase.hostname === endpoint.hostname) {
    throw new Error('Invalid S3 or public HTTPS endpoint');
  }
  const region = config.region ?? 'auto';
  if (!/^[a-z0-9-]{1,40}$/.test(region)) throw new Error('Invalid S3 region');
  if (config.forcePathStyle !== undefined && typeof config.forcePathStyle !== 'boolean') throw new Error('Invalid S3 style');
  client = new S3Client({
    endpoint: endpoint.origin,
    region,
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: {
      accessKeyId: loadCredential('access-key-id'),
      secretAccessKey: loadCredential('secret-access-key'),
    },
    maxAttempts: 2,
  });
  // Only this freshly generated key may be created/deleted by this test.
  key = `modules/noctemblith/media/.manafield-probe/${randomUUID()}.txt`;
  const body = `Manafield R2 public delivery test ${randomUUID()}\n`;
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    throw new Error('Unexpected preexisting test object; refusing overwrite');
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') {
      throw error;
    }
  }
  await client.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain; charset=utf-8',
    CacheControl: 'no-store',
  }));
  created = true;
  console.log('PASS: unique temporary S3 object uploaded');

  const fromS3 = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (await fromS3.Body.transformToString() !== body) throw new Error('S3 object content mismatch');
  console.log('PASS: S3-authenticated object download matches upload');

  const pathname = `${publicBase.pathname.replace(/\/+$/, '')}/${key}`;
  const address = new URL(pathname, publicBase.origin);
  const response = await fetch(address, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (response.status !== 200) {
    console.error(`Public media HTTP status: ${response.status}`);
    throw new Error('Public URL is not serving the test object');
  }
  if (await response.text() !== body) throw new Error('Public object bytes mismatch');
  console.log('PASS: anonymous public HTTPS GET returns the correct object contents');
  result = 0;
} catch (error) {
  // Never serialize errors: SDK/HTTP errors may contain sensitive metadata.
  failSafe(error);
} finally {
  if (client && created && bucket && key) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      console.log('PASS: temporary test object cleaned up');
    } catch {
      console.error('WARNING: temporary probe object cleanup failed. Manual cleanup is required for key: ' + key);
      result = 1;
    }
  }
  client?.destroy();
}
process.exitCode = result;
