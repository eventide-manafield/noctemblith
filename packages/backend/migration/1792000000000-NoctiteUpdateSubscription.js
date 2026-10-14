/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class NoctiteUpdateSubscription1792000000000 {
	name = 'NoctiteUpdateSubscription1792000000000';

	async up(queryRunner) {
		await queryRunner.query('ALTER TABLE "meta" ADD "noctiteUpdateChannel" character varying(64) NOT NULL DEFAULT \'noctite/release/latest\'');
	}

	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "meta" DROP COLUMN "noctiteUpdateChannel"');
	}
}
