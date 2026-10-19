/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Explicit Redis Resource binding; per-service Redis key prefixes are not ACLs.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const prefix = 'MANAFIELD_BINDING_CACHE_';

export type ManafieldRedisBinding = {
  host: string;
  port: number;
  redisPrefix: string;
  pass: string;
};

export function readManafieldRedisBinding(
  env: NodeJS.ProcessEnv = process.env,
  readSecret: (filename: string) => string = filename => readFileSync(filename, 'utf8'),
): ManafieldRedisBinding | null {
  const hasBinding = Object.keys(env).some(name => name.startsWith(prefix));
  const managed = env.MANAFIELD_MODULE_ID !== undefined || env.MANAFIELD_MANAGED === '1';
  if (!hasBinding && !managed) return null;
  if (!managed) throw new Error('Manafield Redis binding supplied outside managed mode');

  const required = (name: string) => {
    const value = env[prefix + name]?.trim();
    if (!value) throw new Error(`Missing required Manafield Redis binding field: ${prefix + name}`);
    return value;
  };

  required('TARGET');
  const host = required('ENDPOINT_HOST');
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host) || host.startsWith('.') || host.includes('..')) {
    throw new Error('Invalid Manafield Redis host');
  }
  const portText = required('ENDPOINT_PORT');
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error('Invalid Manafield Redis port');
  }
  const redisPrefix = required('CONFIG_PREFIX');
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(redisPrefix)) {
    throw new Error('Invalid Manafield Redis key prefix');
  }
  const filename = required('SECRET_PASSWORD_FILE');
  if (!isAbsolute(filename)) throw new Error('Manafield Redis password file path must be absolute');
  let pass: string;
  try {
    pass = readSecret(filename).replace(/\r?\n$/, '');
  } catch {
    throw new Error('Cannot read Manafield Redis password file');
  }
  if (!/^[0-9a-f]{48}$/.test(pass)) throw new Error('Manafield Redis password file is empty or malformed');
  return { host, port: Number(portText), redisPrefix, pass };
}
