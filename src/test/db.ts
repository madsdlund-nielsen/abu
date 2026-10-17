import { describe } from "vitest";

/** `describeDb` springer over uden TEST_DATABASE_URL (enhedstests kræver ingen database). */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
export const describeDb = hasTestDb ? describe : describe.skip;

/** Unikt suffiks, så tests i parallelle filer ikke rører hinandens rækker. */
export const uid = (prefix = "t") => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
