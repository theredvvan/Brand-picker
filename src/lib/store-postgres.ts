import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import type { LogoResult } from "./logo";
import { toKey } from "./normalize";
import type { Auth, ClaimInput, Store } from "./store";
import { hashPin, LOCK_MINUTES, MAX_ATTEMPTS, verifyPin } from "./pin";
import {
  ConflictError,
  LockedError,
  NotAllowedError,
  WrongPinError,
  type ActivityEvent,
  type Claim,
  type Snapshot,
} from "./types";

type Row = Record<string, unknown>;

const toIso = (v: unknown) => new Date(v as string).toISOString();

function claimFromRow(r: Row): Claim {
  return {
    id: Number(r.id),
    studentName: String(r.student_name),
    brandName: String(r.brand_name),
    logoStatus: (r.logo_status as Claim["logoStatus"]) ?? "none",
    logoUrl: (r.logo_url as string) ?? null,
    logoDomain: (r.logo_domain as string) ?? null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function eventFromRow(r: Row): ActivityEvent {
  return {
    id: Number(r.id),
    claimId: r.claim_id == null ? null : Number(r.claim_id),
    action: r.action as ActivityEvent["action"],
    studentName: String(r.student_name),
    brandName: String(r.brand_name),
    prevStudentName: (r.prev_student_name as string) ?? null,
    prevBrandName: (r.prev_brand_name as string) ?? null,
    createdAt: toIso(r.created_at),
  };
}

export class PostgresStore implements Store {
  private sql: NeonQueryFunction<false, false>;
  private ready: Promise<void> | null = null;

  constructor(url: string) {
    this.sql = neon(url);
  }

  /** Creates the tables on first use, so no migration step is needed. */
  private ensureSchema() {
    this.ready ??= (async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS claims (
          id           SERIAL PRIMARY KEY,
          student_name TEXT NOT NULL,
          student_key  TEXT NOT NULL,
          brand_name   TEXT NOT NULL,
          brand_key    TEXT NOT NULL,
          edit_token   TEXT NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
          CONSTRAINT claims_brand_unique   UNIQUE (brand_key),
          CONSTRAINT claims_student_unique UNIQUE (student_key)
        )`;
      await this.sql`ALTER TABLE claims
        ADD COLUMN IF NOT EXISTS logo_status TEXT NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS logo_url    TEXT,
        ADD COLUMN IF NOT EXISTS logo_domain TEXT,
        ADD COLUMN IF NOT EXISTS pin_hash TEXT,
        ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`;
      await this.sql`
        CREATE TABLE IF NOT EXISTS events (
          id                SERIAL PRIMARY KEY,
          claim_id          INTEGER,
          action            TEXT NOT NULL,
          student_name      TEXT NOT NULL,
          brand_name        TEXT NOT NULL,
          prev_student_name TEXT,
          prev_brand_name   TEXT,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
        )`;
    })().catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  /** Converts a unique-constraint violation into a friendly ConflictError. */
  private async rethrow(err: unknown, input: ClaimInput): Promise<never> {
    const e = err as { code?: string; constraint?: string };
    if (e?.code === "23505") {
      if (e.constraint === "claims_brand_unique") {
        const rows = await this
          .sql`SELECT student_name FROM claims WHERE brand_key = ${toKey(input.brandName)}`;
        throw new ConflictError("brand", String(rows[0]?.student_name ?? "someone"));
      }
      if (e.constraint === "claims_student_unique") {
        throw new ConflictError("student", input.studentName);
      }
    }
    throw err;
  }

  async snapshot(): Promise<Snapshot> {
    await this.ensureSchema();
    const [claims, events] = await Promise.all([
      this.sql`SELECT id, student_name, brand_name, logo_status, logo_url, logo_domain,
                      created_at, updated_at
               FROM claims ORDER BY created_at ASC, id ASC`,
      this.sql`SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT 500`,
    ]);
    return {
      claims: (claims as Row[]).map(claimFromRow),
      events: (events as Row[]).map(eventFromRow),
    };
  }

  async claim(input: ClaimInput & { pin: string }) {
    await this.ensureSchema();
    const token = randomBytes(24).toString("base64url");
    try {
      // One statement: the claim and its log entry are written atomically.
      const rows = await this.sql`
        WITH c AS (
          INSERT INTO claims (student_name, student_key, brand_name, brand_key, edit_token, pin_hash)
          VALUES (${input.studentName}, ${toKey(input.studentName)},
                  ${input.brandName}, ${toKey(input.brandName)}, ${token}, ${hashPin(input.pin)})
          RETURNING *
        ), e AS (
          INSERT INTO events (claim_id, action, student_name, brand_name, created_at)
          SELECT id, 'claimed', student_name, brand_name, created_at FROM c
        )
        SELECT * FROM c`;
      return { claim: claimFromRow(rows[0] as Row), token };
    } catch (err) {
      return this.rethrow(err, input);
    }
  }

  async unlock(id: number, pin: string) {
    await this.ensureSchema();
    const rows = await this.sql`
      SELECT *, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60))::int AS lock_minutes
      FROM claims WHERE id = ${id}`;
    const row = rows[0] as Row | undefined;
    if (!row) throw new NotAllowedError();
    if (Number(row.lock_minutes) > 0) throw new LockedError(Number(row.lock_minutes));

    if (verifyPin(pin, row.pin_hash as string)) {
      await this.sql`UPDATE claims SET failed_attempts = 0, locked_until = NULL WHERE id = ${id}`;
      return { claim: claimFromRow(row), token: String(row.edit_token) };
    }

    const [r] = (await this.sql`
      UPDATE claims SET
        failed_attempts = CASE WHEN failed_attempts + 1 >= ${MAX_ATTEMPTS} THEN 0 ELSE failed_attempts + 1 END,
        locked_until    = CASE WHEN failed_attempts + 1 >= ${MAX_ATTEMPTS}
                               THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE NULL END
      WHERE id = ${id}
      RETURNING failed_attempts, locked_until`) as Row[];
    throw new WrongPinError(r?.locked_until ? 0 : MAX_ATTEMPTS - Number(r?.failed_attempts ?? 0));
  }

  async edit(id: number, input: ClaimInput, auth: Auth) {
    await this.ensureSchema();
    const admin = Boolean(auth.admin);
    const token = auth.token ?? "";
    try {
      const rows = await this.sql`
        WITH old AS (
          SELECT * FROM claims
          WHERE id = ${id} AND (${admin} OR edit_token = ${token})
        ), u AS (
          UPDATE claims SET
            student_name = ${input.studentName}, student_key = ${toKey(input.studentName)},
            brand_name   = ${input.brandName},   brand_key   = ${toKey(input.brandName)},
            updated_at   = clock_timestamp(),
            logo_status  = CASE WHEN brand_name = ${input.brandName} THEN logo_status ELSE 'pending' END,
            logo_url     = CASE WHEN brand_name = ${input.brandName} THEN logo_url    ELSE NULL END,
            logo_domain  = CASE WHEN brand_name = ${input.brandName} THEN logo_domain ELSE NULL END
          WHERE id IN (SELECT id FROM old)
          RETURNING *
        ), e AS (
          INSERT INTO events (claim_id, action, student_name, brand_name,
                              prev_student_name, prev_brand_name)
          SELECT u.id, 'edited', u.student_name, u.brand_name, old.student_name, old.brand_name
          FROM u JOIN old ON old.id = u.id
          WHERE u.student_name <> old.student_name OR u.brand_name <> old.brand_name
        )
        SELECT u.*, old.brand_name AS old_brand_name FROM u JOIN old ON old.id = u.id`;
      if (!rows.length) throw new NotAllowedError();
      const row = rows[0] as Row;
      return { claim: claimFromRow(row), brandChanged: row.old_brand_name !== row.brand_name };
    } catch (err) {
      return this.rethrow(err, input);
    }
  }

  async setLogo(id: number, brandName: string, logo: LogoResult | null) {
    await this.ensureSchema();
    await this.sql`
      UPDATE claims SET
        logo_status = ${logo ? "found" : "none"},
        logo_url    = ${logo?.url ?? null},
        logo_domain = ${logo?.domain ?? null}
      WHERE id = ${id} AND brand_name = ${brandName}`;
  }

  async release(id: number, auth: Auth) {
    await this.ensureSchema();
    const admin = Boolean(auth.admin);
    const token = auth.token ?? "";
    const rows = await this.sql`
      WITH d AS (
        DELETE FROM claims
        WHERE id = ${id} AND (${admin} OR edit_token = ${token})
        RETURNING *
      ), e AS (
        INSERT INTO events (claim_id, action, student_name, brand_name)
        SELECT id, 'released', student_name, brand_name FROM d
      )
      SELECT id FROM d`;
    if (!rows.length) throw new NotAllowedError();
  }
}
