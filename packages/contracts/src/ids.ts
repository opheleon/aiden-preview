import { z } from 'zod/v3';

/** Stable requirement identifier; numbers are never reused once retired. */
export const requirementId = z.string().regex(/^REQ-[1-9]\d*$/);
/** Edge-case identifier, unique within its requirement. */
export const edgeCaseId = z.string().regex(/^E[1-9]\d*$/);
