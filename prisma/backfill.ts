/**
 * Prepares an existing database for the "every job has a crew" schema change.
 *
 * Must run BEFORE `prisma db push`, because push cannot make Job.crewId NOT NULL
 * while null rows exist, and cannot drop the ONE_TIME service enum value while
 * rows still use it.
 *
 * Uses `pg` directly rather than the Prisma client: the client is generated from
 * the new schema, so it can no longer express the old ONE_TIME value this script
 * needs to read. Safe to run repeatedly.
 */
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const { rows: tableRows } = await client.query<{ exists: string | null }>(
      `SELECT to_regclass('public."Job"')::text AS exists`,
    );
    if (!tableRows[0]?.exists) {
      console.log("No Job table yet — nothing to backfill.");
      return;
    }

    // db push would add this column itself, but the ONE_TIME conversion below
    // needs somewhere to record the old label first.
    await client.query(`ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "customService" TEXT`);

    const { rows: nullCrew } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Job" WHERE "crewId" IS NULL`,
    );
    const nullCrewCount = Number(nullCrew[0].count);

    if (nullCrewCount > 0) {
      const { rows: crews } = await client.query<{ id: string }>(
        `SELECT id FROM "Crew" ORDER BY "createdAt" ASC LIMIT 1`,
      );

      let crewId = crews[0]?.id;
      if (!crewId) {
        crewId = crypto.randomUUID();
        await client.query(
          `INSERT INTO "Crew" (id, name, color, active, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, true, now(), now())`,
          [crewId, "Crew 1", "#2563eb"],
        );
        console.log(`No crews existed — created "Crew 1" to hold unassigned jobs.`);
      }

      await client.query(`UPDATE "Job" SET "crewId" = $1 WHERE "crewId" IS NULL`, [crewId]);
      console.log(`Assigned ${nullCrewCount} unassigned job(s) to crew ${crewId}.`);
    } else {
      console.log("No unassigned jobs to migrate.");
    }

    const { rows: enumRows } = await client.query(
      `SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'ServiceType' AND e.enumlabel = 'ONE_TIME'`,
    );

    if (enumRows.length > 0) {
      const result = await client.query(
        `UPDATE "Job"
         SET "serviceType" = 'OTHER', "customService" = COALESCE("customService", 'One-time')
         WHERE "serviceType" = 'ONE_TIME'`,
      );
      console.log(`Converted ${result.rowCount} job(s) from service ONE_TIME to OTHER.`);
    } else {
      console.log("ServiceType.ONE_TIME already removed — nothing to convert.");
    }

    console.log("Backfill complete. Now run: npm run db:push");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
