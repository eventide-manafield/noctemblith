/*
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { describe, expect, test } from 'vitest';
import { readManafieldRedisBinding } from '@/misc/manafield-redis-binding.js';

const managed = {
  MANAFIELD_MODULE_ID: 'noctemblith',
  MANAFIELD_BINDING_CACHE_TARGET: 'manafield-redis',
  MANAFIELD_BINDING_CACHE_ENDPOINT_HOST: 'manafield-redis',
  MANAFIELD_BINDING_CACHE_ENDPOINT_PORT: '6379',
  MANAFIELD_BINDING_CACHE_CONFIG_PREFIX: 'mf_noctemblith_cache',
  MANAFIELD_BINDING_CACHE_SECRET_PASSWORD_FILE: '/run/manafield/bindings/cache/password',
};
const password = 'a'.repeat(48);

describe('Manafield Redis Resource Binding', () => {
  test('standalone retains existing Redis configuration', () => {
    expect(readManafieldRedisBinding({})).toBeNull();
  });
  test('binds an explicit Redis Resource using its private password file', () => {
    expect(readManafieldRedisBinding(managed, () => password + '\n')).toEqual({
      host: 'manafield-redis', port: 6379, redisPrefix: 'mf_noctemblith_cache', pass: password,
    });
  });
  test('managed mode does not silently use standalone Redis', () => {
    expect(() => readManafieldRedisBinding({ MANAFIELD_MODULE_ID: 'noctemblith' })).toThrow('TARGET');
  });
  test('detects incomplete and wrong-managed-mode binding', () => {
    const { MANAFIELD_BINDING_CACHE_CONFIG_PREFIX: _prefix, ...incomplete } = managed;
    expect(() => readManafieldRedisBinding(incomplete, () => password)).toThrow('CONFIG_PREFIX');
    const { MANAFIELD_MODULE_ID: _managed, ...outside } = managed;
    expect(() => readManafieldRedisBinding(outside, () => password)).toThrow('outside managed');
  });
  test('refuses invalid ports and prefixes', () => {
    expect(() => readManafieldRedisBinding({...managed,MANAFIELD_BINDING_CACHE_ENDPOINT_PORT:'0'}, () => password)).toThrow('port');
    expect(() => readManafieldRedisBinding({...managed,MANAFIELD_BINDING_CACHE_CONFIG_PREFIX:'../../other'}, () => password)).toThrow('prefix');
  });
  test('does not expose secret file errors', () => {
    expect(() => readManafieldRedisBinding(managed, () => {throw new Error('private secret path')})).toThrow('Cannot read');
    expect(() => readManafieldRedisBinding(managed, () => 'my-password')).toThrow('malformed');
  });
});
