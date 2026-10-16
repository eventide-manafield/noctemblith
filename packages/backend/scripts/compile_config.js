/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * YAMLファイルをJSONファイルに変換するスクリプト
 * ビルド前に実行し、ランタイムにjs-yamlを含まないようにする
 */

import fs from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const configDir = resolve(_dirname, '../../../.config');
const OUTPUT_PATH = resolve(_dirname, '../../../built/.config.json');

// TODO: yamlのパースに失敗したときのエラーハンドリング

/**
 * YAMLファイルをJSONファイルに変換
 * @param {string} ymlPath - YAMLファイルのパス
 */
function yamlToJson(ymlPath) {
	if (!fs.existsSync(ymlPath)) {
		console.warn(`YAML file not found: ${ymlPath}`);
		return;
	}

	console.log(`${ymlPath} → ${OUTPUT_PATH}`);

	const yamlContent = fs.readFileSync(ymlPath, 'utf-8');
	const jsonContent = loadYaml(yamlContent);
	if (!fs.existsSync(dirname(OUTPUT_PATH))) {
		fs.mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
	}
	fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
		'_NOTE_': 'This file is auto-generated from YAML file. DO NOT EDIT.',
		...jsonContent,
	}), 'utf-8');
}

// Managed Noctemblith reads its runtime definition and Resource Bindings
// directly from the environment; no writable .config/default.yml is required.
if (process.env.MANAFIELD_MODULE_ID !== undefined || process.env.MANAFIELD_MANAGED === '1') {
	console.log('Manafield-managed runtime: external configuration selected.');
	process.exit(0);
}

if (process.env.MISSKEY_CONFIG_YML) {
	const customYmlPath = resolve(configDir, process.env.MISSKEY_CONFIG_YML);
	yamlToJson(customYmlPath);
} else {
	yamlToJson(resolve(configDir, process.env.NODE_ENV === 'test' ? 'test.yml' : 'default.yml'));
}

console.log('Configuration compiled ✓');
