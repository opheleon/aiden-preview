import { z } from 'zod/v3';

/** Shared, non-secret Apple signing choices used only by Aiden's managed phone connection. */
export const PhoneSetupSchema = z
  .object({
    teamId: z
      .string()
      .regex(/^[A-Z0-9]{10}$/)
      .optional(),
    runnerBundleId: z
      .string()
      .regex(/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/)
      .max(200)
      .optional(),
  })
  .strict();
/** Optional signing overrides; an existing Xcode signing configuration may also be used. */
export type PhoneSetup = z.infer<typeof PhoneSetupSchema>;
/** A discovered physical iPhone; identifiers are used internally by the worker. */
export type PhoneChoice = { udid: string; name: string; version: string; state: string };
/** Installed app metadata observed on the selected phone, not proof of its source commit. */
export type PhoneApp = { bundleId: string; name: string; version: string; build: string };
/** Actionable local prerequisite checks without forwarding process output. */
export type PhoneReadiness = {
  settings: PhoneSetup;
  checks: { name: string; ready: boolean; message: string }[];
  phones: PhoneChoice[];
};
