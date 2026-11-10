export type Claim = {
  id: number;
  studentName: string;
  brandName: string;
  /** "pending" while the logo is being looked up, then "found" or "none". */
  logoStatus: LogoStatus;
  logoUrl: string | null;
  logoDomain: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LogoStatus = "pending" | "found" | "none";

export type EventAction = "claimed" | "edited" | "released";

export type ActivityEvent = {
  id: number;
  claimId: number | null;
  action: EventAction;
  studentName: string;
  brandName: string;
  prevStudentName: string | null;
  prevBrandName: string | null;
  createdAt: string;
};

export type Snapshot = {
  claims: Claim[];
  events: ActivityEvent[];
};

/** Thrown when a brand or a student name is already taken. */
export class ConflictError extends Error {
  readonly kind = "conflict";
  constructor(
    public field: "brand" | "student",
    public owner: string,
  ) {
    super(
      field === "brand"
        ? `This brand is already taken by ${owner}.`
        : `${owner} already has a brand. Edit it instead of adding a new one.`,
    );
  }
}

export class NotAllowedError extends Error {
  readonly kind = "not-allowed";
  constructor() {
    super("This isn't your pick. Use “This is me” with your PIN to unlock it.");
  }
}

export class WrongPinError extends Error {
  readonly kind = "wrong-pin";
  constructor(public remaining: number) {
    super(
      remaining > 0
        ? `Wrong PIN. ${remaining} ${remaining === 1 ? "try" : "tries"} left.`
        : "Wrong PIN. Too many tries: this pick is locked for 15 minutes.",
    );
  }
}

export class LockedError extends Error {
  readonly kind = "locked";
  constructor(public minutes: number) {
    super(`Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask the class rep.`);
  }
}
