import { z } from 'zod/v3';

/** Conventional same-origin form login, completed privately before agent observations begin. */
export const WebLoginSchema = z
  .object({
    loginUrl: z.string().url().max(2000),
    // Read older saved settings; sign-in detection no longer needs a supplied text marker.
    successText: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
/** Private input accepted by the worker; never included in public verification settings. */
export const WebCredentialsSchema = z
  .object({
    username: z.string().min(1).max(500),
    password: z.string().min(1).max(500),
  })
  .strict();
/** Supported locations for one API key; secrets are never placed in URLs. */
export const ApiKeyHeaderSchema = z.enum(['X-API-Key', 'Authorization']);
