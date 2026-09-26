import postgres from "postgres";
import { requiredEnv } from "./errors";

let connection: ReturnType<typeof postgres> | undefined;
export function db() {
  if (!connection)
    connection = postgres(requiredEnv("DATABASE_URL"), {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      // TLS is required in production. The explicit local override is for a local database only.
      ssl:
        process.env.DATABASE_LOCAL_INSECURE === "true" &&
        process.env.NODE_ENV !== "production"
          ? false
          : "require",
    });
  return connection;
}

export type Transaction = postgres.TransactionSql;

export async function rateLimit(subject: string, scope: string, limit = 20) {
  const sql = db();
  const rows = await sql`
    INSERT INTO request_limits (subject, scope, bucket, attempts)
    VALUES (${subject}, ${scope}, date_trunc('minute', now()), 1)
    ON CONFLICT (subject, scope, bucket) DO UPDATE SET attempts = request_limits.attempts + 1
    RETURNING attempts`;
  if (Number(rows[0].attempts) > limit) {
    const { ApiError } = await import("./errors");
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many attempts. Please wait a minute.",
    );
  }
}
