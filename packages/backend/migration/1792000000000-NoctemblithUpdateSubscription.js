/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class NoctemblithUpdateSubscription1792000000000 {
	name = 'NoctemblithUpdateSubscription1792000000000';

	async up(queryRunner) {
		await queryRunner.query("ALTER TABLE \"meta\" ADD \"noctemblithUpdateChannel\" character varying(64) NOT NULL DEFAULT 'noctemblith/release/latest'");
	}

	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "meta" DROP COLUMN "noctemblithUpdateChannel"');
	}
}
