/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class NoctemblithUpdateChannelColumn1792000000004 {
	name = 'NoctemblithUpdateChannelColumn1792000000004';

	async up(queryRunner) {
		await queryRunner.query('ALTER TABLE "meta" RENAME COLUMN "noctiteUpdateChannel" TO "noctemblithUpdateChannel"');
	}

	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "meta" RENAME COLUMN "noctemblithUpdateChannel" TO "noctiteUpdateChannel"');
	}
}
