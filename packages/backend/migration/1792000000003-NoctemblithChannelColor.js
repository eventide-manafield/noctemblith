/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class NoctemblithChannelColor1792000000003 {
	name = 'NoctemblithChannelColor1792000000003';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "channel" ALTER COLUMN "color" SET DEFAULT '#7A35B6'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "channel" ALTER COLUMN "color" SET DEFAULT '#86b300'`);
	}
}
