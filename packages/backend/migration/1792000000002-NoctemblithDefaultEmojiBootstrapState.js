/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class NoctemblithDefaultEmojiBootstrapState1792000000002 {
    name = 'NoctemblithDefaultEmojiBootstrapState1792000000002';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "noctemblith_bootstrap_state" (
            "key" character varying(128) NOT NULL,
            "completedAt" timestamp with time zone NOT NULL DEFAULT now(),
            CONSTRAINT "PK_noctemblith_bootstrap_state" PRIMARY KEY ("key")
        )`);
    }

    async down(queryRunner) {
        await queryRunner.query('DROP TABLE "noctemblith_bootstrap_state"');
    }
}
