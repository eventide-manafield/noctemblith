/*
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * PostgreSQL configuration injected by Manafield's explicit Resource binding.
 * The binding belongs to the running application, not its health-only adapter.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const prefix = 'MANAFIELD_BINDING_STATE_';

export type ManafieldDatabaseBinding = {
	host: string;
	port: number;
	db: string;
	user: string;
	pass: string;
	schema: string;
};

/**
 * Standalone Noctemblith keeps its own database config. A process started as
 * a Manafield Module must receive a complete, explicit PostgreSQL binding.
 * Never silently fall back to the standalone database in managed mode.
 */
export function readManafieldDatabaseBinding(
	env: NodeJS.ProcessEnv = process.env,
	readSecret: (filename: string) => string = filename => readFileSync(filename, 'utf8'),
): ManafieldDatabaseBinding | null {
	const hasBindingFields = Object.keys(env).some(key => key.startsWith(prefix));
	const managed = env.MANAFIELD_MODULE_ID !== undefined || env.MANAFIELD_MANAGED === '1';
	if (!managed && !hasBindingFields) return null;
	if (!managed) throw new Error('Manafield database binding was provided outside Manafield managed mode');

	const required = (suffix: string): string => {
		const name = prefix + suffix;
		const value = env[name]?.trim();
		if (!value) throw new Error(`Missing required Manafield PostgreSQL binding field: ${name}`);
		return value;
	};

	// A declared target is required even if legacy standalone DB settings exist.
	required('TARGET');
	const host = required('ENDPOINT_HOST');
	const portText = required('ENDPOINT_PORT');
	if (!/^[0-9]+$/.test(portText)) {
		throw new Error('Invalid Manafield PostgreSQL binding port');
	}
	const port = Number(portText);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
		throw new Error('Invalid Manafield PostgreSQL binding port');
	}
	const db = required('CONFIG_DATABASE');
	const user = required('CONFIG_USERNAME');
	const schema = required('CONFIG_SCHEMA');
	if (!/^[a-z_][a-z0-9_]*$/.test(schema) || schema.length > 63) {
		throw new Error('Invalid Manafield PostgreSQL binding schema');
	}

	const passwordPath = required('SECRET_PASSWORD_FILE');
	if (!isAbsolute(passwordPath)) {
		throw new Error('Manafield PostgreSQL binding password must use an absolute secret-file path');
	}
	let password: string;
	try {
		password = readSecret(passwordPath).replace(/\r?\n$/, '');
	} catch {
		// Do not include the filename or secret in error messages.
		throw new Error('Cannot read Manafield PostgreSQL binding password file');
	}
	if (!password || /[\r\n]/.test(password)) {
		throw new Error('Manafield PostgreSQL binding password file is empty or malformed');
	}
	return { host, port, db, user, pass: password, schema };
}
