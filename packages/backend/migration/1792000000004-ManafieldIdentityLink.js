/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Persistent, provider-scoped mapping from Account Core's UUID sub to a local
 * Noctemblith user. This does not establish a login or claim any existing user.
 */
export class ManafieldIdentityLink1792000000004 {
	name = 'ManafieldIdentityLink1792000000004';

	async up(queryRunner) {
		await queryRunner.query(`
CREATE TABLE "manafield_identity_link" (
	"providerId" character varying(64) NOT NULL,
	"subjectUuid" uuid NOT NULL,
	"userId" character varying(32) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "PK_manafield_identity_link" PRIMARY KEY ("providerId", "subjectUuid"),
	CONSTRAINT "UQ_manafield_identity_link_user" UNIQUE ("providerId", "userId"),
	CONSTRAINT "CHK_manafield_identity_link_provider" CHECK ("providerId" ~ '^[a-z0-9_-]{1,64}$'),
	CONSTRAINT "FK_manafield_identity_link_user" FOREIGN KEY ("userId")
		REFERENCES "user"("id") ON DELETE CASCADE
)
		`);
		// A foreign key alone is insufficient: it also permits remote AP
		// actors. Only host=NULL local accounts may be associated.
		await queryRunner.query(`
CREATE FUNCTION enforce_manafield_identity_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'identity links are immutable' USING ERRCODE = '23514';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "user" WHERE "id" = NEW."userId" AND "host" IS NULL
	) THEN
		RAISE EXCEPTION 'identity link requires a local Noctemblith user'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END
$$
		`);
		await queryRunner.query(`
CREATE TRIGGER "TR_manafield_identity_link_guard"
	BEFORE INSERT OR UPDATE ON "manafield_identity_link"
	FOR EACH ROW EXECUTE FUNCTION enforce_manafield_identity_link()
		`);
	}

	async down(queryRunner) {
		await queryRunner.query('DROP TABLE "manafield_identity_link"');
		await queryRunner.query('DROP FUNCTION enforce_manafield_identity_link()');
	}
}
