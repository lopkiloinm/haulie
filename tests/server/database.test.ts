import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

// Run only against an EMPTY disposable database. These are real PostgreSQL
// transaction/uniqueness tests; no live World ID or blockchain result is mocked.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { max: 5, ssl: false }) : null;
after(async () => {
  if (sql) await sql.end();
});

test(
  "PostgreSQL enforces exclusive assignment, replay rollback, and payout uniqueness",
  { skip: !sql },
  async () => {
    if (!sql) return;
    const migration = await sql.reserve();
    try {
      await migration.unsafe(
        await readFile(
          new URL("../../database/001_initial.sql", import.meta.url),
          "utf8",
        ),
      );
    } finally {
      migration.release();
    }
    const merchant = randomUUID(),
      courierA = randomUUID(),
      courierB = randomUUID(),
      job = randomUUID();
    for (const [id, role] of [
      [merchant, "merchant"],
      [courierA, "courier"],
      [courierB, "courier"],
    ]) {
      await sql`INSERT INTO accounts (id,role,display_name,access_token_hash) VALUES (${id}, ${role}, 'Test account', ${"0".repeat(64)})`;
      if (role === "courier")
        await sql`INSERT INTO couriers(id) VALUES (${id})`;
    }
    await sql`INSERT INTO jobs (id,merchant_id,parcel_category,pickup_area,destination_area,pickup_address,destination_address,fee_usdc,state,escrow_object_id,delivery_deadline,cancellation_rules) VALUES (${job},${merchant},'Books','North','South','Private pickup','Private recipient',6000000,'FUNDED','0xescrow',now() + interval '1 day','Before pickup only')`;
    const accept = (courier: string) =>
      sql.begin(async (tx) => {
        const rows =
          await tx`SELECT state FROM jobs WHERE id = ${job} FOR UPDATE`;
        if (rows[0].state !== "FUNDED") return false;
        await tx`UPDATE jobs SET state = 'ASSIGNED', assigned_courier_id = ${courier}, payout_address = '0x123', assignment_generation = 1 WHERE id = ${job}`;
        return true;
      });
    const race = await Promise.all([accept(courierA), accept(courierB)]);
    assert.equal(
      race.filter(Boolean).length,
      1,
      "Only one concurrent courier wins the row lock and assignment",
    );

    const selected = (
      await sql`SELECT assigned_courier_id FROM jobs WHERE id = ${job}`
    )[0].assigned_courier_id;
    await sql`INSERT INTO used_world_proofs (proof_identifier,courier_id,proof_type) VALUES ('consumed-proof',${selected},'session')`;
    await assert.rejects(
      sql.begin(async (tx) => {
        await tx`UPDATE jobs SET state = 'PICKED_UP' WHERE id = ${job}`;
        await tx`INSERT INTO used_world_proofs (proof_identifier,courier_id,proof_type) VALUES ('consumed-proof',${selected},'session')`;
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505",
    );
    assert.equal(
      (await sql`SELECT state FROM jobs WHERE id = ${job}`)[0].state,
      "ASSIGNED",
      "A replay must roll back custody transition in the same transaction",
    );

    await sql`INSERT INTO settlements (job_id,payout_amount,wallet_address,digest,status) VALUES (${job},6000000,'0x123','confirmed-digest','paid')`;
    await assert.rejects(
      sql`INSERT INTO settlements (job_id,payout_amount,wallet_address,digest,status) VALUES (${job},6000000,'0x456','second-digest','paid')`,
      /duplicate key/,
    );
    await sql`INSERT INTO job_events (job_id,actor_role,event_type) VALUES (${job},'operator','TEST_EVENT')`;
    await assert.rejects(
      sql`DELETE FROM job_events WHERE job_id = ${job}`,
      /append-only/,
    );
  },
);
