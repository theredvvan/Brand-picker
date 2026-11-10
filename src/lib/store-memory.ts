import { randomBytes } from "node:crypto";
import type { LogoResult } from "./logo";
import { toKey } from "./normalize";
import { hashPin, LOCK_MINUTES, MAX_ATTEMPTS, verifyPin } from "./pin";
import type { Auth, ClaimInput, Store } from "./store";
import {
  ConflictError,
  LockedError,
  NotAllowedError,
  WrongPinError,
  type ActivityEvent,
  type Claim,
} from "./types";

type Secrets = { token: string; pinHash: string; failedAttempts: number; lockedUntil: number };
type StoredClaim = Claim & Secrets;

const publicClaim = ({ token: _t, pinHash: _p, failedAttempts: _f, lockedUntil: _l, ...c }: StoredClaim): Claim => c;

/** Development-only store used when DATABASE_URL is missing. Data resets on restart. */
export class MemoryStore implements Store {
  private claims: StoredClaim[] = [];
  private events: ActivityEvent[] = [];
  private nextClaimId = 1;
  private nextEventId = 1;

  static shared(): MemoryStore {
    const g = globalThis as unknown as { __brandStore?: MemoryStore };
    return (g.__brandStore ??= new MemoryStore());
  }

  private checkUnique(input: ClaimInput, ignoreId?: number) {
    const others = this.claims.filter((c) => c.id !== ignoreId);
    const brand = others.find((c) => toKey(c.brandName) === toKey(input.brandName));
    if (brand) throw new ConflictError("brand", brand.studentName);
    if (others.some((c) => toKey(c.studentName) === toKey(input.studentName)))
      throw new ConflictError("student", input.studentName);
  }

  private log(e: Omit<ActivityEvent, "id" | "createdAt">) {
    this.events.unshift({ ...e, id: this.nextEventId++, createdAt: new Date().toISOString() });
  }

  private find(id: number, auth: Auth) {
    const c = this.claims.find((x) => x.id === id);
    if (!c || (!auth.admin && c.token !== auth.token)) throw new NotAllowedError();
    return c;
  }

  async snapshot() {
    return { claims: this.claims.map(publicClaim), events: [...this.events] };
  }

  async claim({ studentName, brandName, pin }: ClaimInput & { pin: string }) {
    this.checkUnique({ studentName, brandName });
    const now = new Date().toISOString();
    const token = randomBytes(24).toString("base64url");
    const c: StoredClaim = {
      id: this.nextClaimId++,
      studentName,
      brandName,
      logoStatus: "pending",
      logoUrl: null,
      logoDomain: null,
      createdAt: now,
      updatedAt: now,
      token,
      pinHash: hashPin(pin),
      failedAttempts: 0,
      lockedUntil: 0,
    };
    this.claims.push(c);
    this.log({ claimId: c.id, action: "claimed", studentName, brandName, prevStudentName: null, prevBrandName: null });
    return { claim: publicClaim(c), token };
  }

  async unlock(id: number, pin: string) {
    const c = this.claims.find((x) => x.id === id);
    if (!c) throw new NotAllowedError();
    if (c.lockedUntil > Date.now()) throw new LockedError(Math.ceil((c.lockedUntil - Date.now()) / 60000));
    if (verifyPin(pin, c.pinHash)) {
      c.failedAttempts = 0;
      return { claim: publicClaim(c), token: c.token };
    }
    c.failedAttempts += 1;
    const remaining = MAX_ATTEMPTS - c.failedAttempts;
    if (remaining <= 0) {
      c.failedAttempts = 0;
      c.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
    }
    throw new WrongPinError(Math.max(remaining, 0));
  }

  async edit(id: number, input: ClaimInput, auth: Auth) {
    const c = this.find(id, auth);
    this.checkUnique(input, id);
    const prev = { studentName: c.studentName, brandName: c.brandName };
    const brandChanged = prev.brandName !== input.brandName;
    Object.assign(c, { studentName: input.studentName, brandName: input.brandName, updatedAt: new Date().toISOString() });
    if (brandChanged) Object.assign(c, { logoStatus: "pending", logoUrl: null, logoDomain: null });
    if (prev.studentName !== c.studentName || prev.brandName !== c.brandName)
      this.log({
        claimId: id,
        action: "edited",
        studentName: c.studentName,
        brandName: c.brandName,
        prevStudentName: prev.studentName,
        prevBrandName: prev.brandName,
      });
    return { claim: publicClaim(c), brandChanged };
  }

  async setLogo(id: number, brandName: string, logo: LogoResult | null) {
    const c = this.claims.find((x) => x.id === id && x.brandName === brandName);
    if (!c) return;
    Object.assign(c, {
      logoStatus: logo ? "found" : "none",
      logoUrl: logo?.url ?? null,
      logoDomain: logo?.domain ?? null,
    });
  }

  async release(id: number, auth: Auth) {
    const c = this.find(id, auth);
    this.claims = this.claims.filter((x) => x.id !== id);
    this.log({
      claimId: id,
      action: "released",
      studentName: c.studentName,
      brandName: c.brandName,
      prevStudentName: null,
      prevBrandName: null,
    });
  }
}
