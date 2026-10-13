/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * This marker is created by a standard, one-time TypeORM migration.
 * Installation of the corresponding default emoji is performed by the
 * backend at first startup, when its canonical instance URL and chosen
 * ID-generation method are available.
 */
export class NoctiteDefaultEmojiBootstrapState1791940000000 {
	name = 'NoctiteDefaultEmojiBootstrapState1791940000000';

	async up(queryRunner) {
		await queryRunner.query(`CREATE TABLE "noctite_bootstrap_state" (
			"key" character varying(128) NOT NULL,
			"completedAt" timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT "PK_noctite_bootstrap_state" PRIMARY KEY ("key")
		)`);
	}

	async down(queryRunner) {
		await queryRunner.query('DROP TABLE "noctite_bootstrap_state"');
	}
}
