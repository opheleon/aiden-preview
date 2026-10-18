import { z } from 'zod/v3';

import { RuntimeSchema } from './runtime.js';

/** Local Appium endpoint only; no credentials, redirects, or arbitrary URL paths. */
export const DeviceTargetSchema = z
  .object({
    connection: z.enum(['managed', 'manual']).optional(),
    deviceName: z.string().max(300).optional(),
    appName: z.string().max(300).optional(),
    serverUrl: z
      .string()
      .url()
      .max(2000)
      .refine((raw) => {
        let u: URL;
        try {
          u = new URL(raw);
        } catch {
          return false;
        }
        return (
          u.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash &&
          ['/', '/wd/hub', '/wd/hub/'].includes(u.pathname)
        );
      }, 'Use a local Appium address, such as http://127.0.0.1:4723.')
      .default('http://127.0.0.1:4723'),
    udid: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{8}-[a-fA-F0-9]{16})$/),
    bundleId: z
      .string()
      .regex(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/)
      .max(200),
  })
  .strict();
/** A physical iPhone and an app already installed by its tester. */
export type DeviceTarget = z.infer<typeof DeviceTargetSchema>;

/** Explicit phone follow-up for a project assessment; requirements and provider come from the project. */
export const ProjectDeviceTestSchema = z
  .object({
    target: DeviceTargetSchema,
    buildLabel: z.string().trim().min(1).max(120),
    allowInteractions: z.literal(true),
    stepLimit: z.number().int().min(5).max(60).default(25),
  })
  .strict();
/** One authorized installed-build check after a code assessment. */
export type ProjectDeviceTest = z.infer<typeof ProjectDeviceTestSchema>;

/** Worker-derived provenance joining UI evidence to an accepted code assessment. */
const DeviceSourceSchema = z
  .object({
    projectId: z.string(),
    reportId: z.string(),
    baselineId: z.string(),
    snapshots: z.array(z.object({ repositoryId: z.string(), sha: z.string() }).strict()),
    checks: z.array(
      z
        .object({
          requirementId: z.string(),
          edgeCaseId: z.string().nullable(),
          codeStatus: z.enum(['implemented', 'partial', 'missing', 'unknown']),
          codeExplanation: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
/** Immutable report identity and matching requirement assessments, supplied only by the worker. */
export type DeviceSource = z.infer<typeof DeviceSourceSchema>;

/** Low-level acceptance test; authorization applies to this selected app and test account. */
export const DeviceTestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    target: DeviceTargetSchema,
    buildLabel: z.string().trim().min(1).max(120),
    criteria: z.array(z.string().trim().min(1).max(2000)).min(1).max(200),
    runtime: RuntimeSchema,
    allowInteractions: z.literal(true),
    stepLimit: z.number().int().min(5).max(60).default(25),
  })
  .strict();
/** Validated request for an independent device test. */
export type DeviceTest = z.infer<typeof DeviceTestSchema>;

/** Timestamped observation with fixed relative evidence filenames. */
const ObservationSchema = z
  .object({
    id: z.number().int().positive(),
    action: z.string(),
    result: z.string(),
    screenshot: z.string().regex(/^step-[1-9]\d*\.png$/),
    hierarchy: z.string().regex(/^step-[1-9]\d*\.xml$/),
    at: z.string().datetime(),
  })
  .strict();
/** Recorded UI observation, independent of the agent's final claims. */
export type DeviceObservation = z.infer<typeof ObservationSchema>;
const CriterionSchema = z
  .object({
    criterion: z.string(),
    verdict: z.enum(['pass', 'fail', 'unverified']),
    explanation: z.string(),
    evidence: z.array(z.number().int().positive()).max(8),
    observations: z.array(ObservationSchema).max(60),
  })
  .strict();
/** A criterion verdict backed by independently reviewed observations. */
export type DeviceCriterion = z.infer<typeof CriterionSchema>;
/** Validate saved evidence before exposing it through the worker or opening its report. */
export const DeviceRunSchema = z
  .object({
    id: z.string().uuid(),
    ownerPid: z.number().int().positive(),
    name: z.string(),
    bundleId: z.string(),
    buildLabel: z.string(),
    device: z.record(z.string()),
    runtime: RuntimeSchema,
    runtimeVersion: z.string().nullable(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    message: z.string(),
    startedAt: z.string().datetime(),
    criteria: z.array(CriterionSchema).max(200),
    source: DeviceSourceSchema.optional(),
    reportPath: z.string(),
  })
  .strict();
/** Persisted device run with optional worker-derived project assessment provenance. */
export type DeviceRun = z.infer<typeof DeviceRunSchema>;
