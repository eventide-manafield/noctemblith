/*
 * SPDX-FileCopyrightText: Noctite contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
export class NoctemblithUpdateChannels1792000000001 {
    name = 'NoctemblithUpdateChannels1792000000001';

    async up(queryRunner) {
        await queryRunner.query("ALTER TABLE \"meta\" ALTER COLUMN \"noctiteUpdateChannel\" SET DEFAULT 'noctemblith/release/latest'");
        await queryRunner.query(`UPDATE "meta" SET "noctiteUpdateChannel" = CASE "noctiteUpdateChannel"
            WHEN 'noctite/dev' THEN 'noctemblith/dev'
            ELSE 'noctemblith/release/latest'
            END WHERE "noctiteUpdateChannel" IN ('noctite/dev', 'noctite/release/latest')`);
    }

    async down(queryRunner) {
        await queryRunner.query(`UPDATE "meta" SET "noctiteUpdateChannel" = CASE "noctiteUpdateChannel"
            WHEN 'noctemblith/dev' THEN 'noctite/dev'
            ELSE 'noctite/release/latest'
            END WHERE "noctiteUpdateChannel" IN ('noctemblith/dev', 'noctemblith/release/latest')`);
        await queryRunner.query("ALTER TABLE \"meta\" ALTER COLUMN \"noctiteUpdateChannel\" SET DEFAULT 'noctite/release/latest'");
    }
}
