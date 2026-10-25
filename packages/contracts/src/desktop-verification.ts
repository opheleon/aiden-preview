import { z } from 'zod/v3';

import { RuntimeSchema } from './runtime.js';

/** An app already installed on this computer: a macOS .app bundle or a Windows .exe. */
export const DesktopTargetSchema = z
  .object({
    /** Absolute path, such as /Applications/Notes.app or C:\\Program Files\\Notes\\Notes.exe. */
    appPath: z
      .string()
      .min(2)
      .max(2000)
      .refine((value) => /^(\/|[A-Za-z]:\\)/.test(value), 'Use the full path to the installed app.')
      .refine((value) => /\.(app|exe)\/?$/i.test(value), 'Choose a macOS .app or a Windows .exe.'),
  })
  .strict();

/** Explicit acceptance test of an installed app; interactions may change its data and settings. */
export const DesktopTestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    target: DesktopTargetSchema,
    criteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(200),
    runtime: RuntimeSchema,
    allowInteractions: z.literal(true),
    stepLimit: z.number().int().min(5).max(60).default(25),
  })
  .strict();
/** One desktop test run request. */
export type DesktopTest = z.infer<typeof DesktopTestSchema>;

const ObservationSchema = z
  .object({
    id: z.number().int().positive(),
    action: z.string(),
    result: z.string(),
    screenshot: z.string().regex(/^step-\d+\.png$/),
    tree: z.string().regex(/^step-\d+\.json$/),
    at: z.string(),
  })
  .strict();
/** One recorded window screenshot and accessibility tree after an action. */
export type DesktopObservation = z.infer<typeof ObservationSchema>;

const CriterionSchema = z
  .object({
    criterion: z.string(),
    verdict: z.enum(['pass', 'fail', 'unverified']),
    explanation: z.string(),
    evidence: z.array(z.number().int().positive()).max(8),
    observations: z.array(ObservationSchema).max(60),
  })
  .strict();
/** Reviewed verdict and evidence for one criterion. */
export type DesktopCriterion = z.infer<typeof CriterionSchema>;

/** Installed app identity read from the app itself. */
export const DesktopAppSchema = z
  .object({
    path: z.string().max(2000),
    name: z.string().max(300),
    identifier: z.string().max(300),
    version: z.string().max(100),
    signer: z.string().max(300).optional(),
    signature: z.enum(['trusted', 'unsigned']).optional(),
  })
  .strict();
/** Name, identifier, version, and signer of an installed app. */
export type DesktopApp = z.infer<typeof DesktopAppSchema>;

/** Saved run record, with the app version before and after so updates during a test are visible. */
export const DesktopRunSchema = z
  .object({
    id: z.string().uuid(),
    ownerPid: z.number().int().positive(),
    name: z.string(),
    app: DesktopAppSchema.nullable(),
    versionAfter: z.string().nullable(),
    runtime: RuntimeSchema,
    runtimeVersion: z.string().nullable(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    message: z.string(),
    startedAt: z.string(),
    criteria: z.array(CriterionSchema).max(200),
    reportPath: z.string(),
  })
  .strict();
/** A desktop check and its evidence. */
export type DesktopRun = z.infer<typeof DesktopRunSchema>;

/** Whether this computer lets Aiden read and drive installed apps, with the next step when not. */
export interface DesktopReadiness {
  ready: boolean;
  checks: { name: string; ready: boolean; message: string }[];
}
