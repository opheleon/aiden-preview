/**
 * Which copy of Aiden is running. Production (`Aiden`) and `Aiden Beta` are separate installed
 * apps with their own data, sign-in, servers, and update feed; `local` is any unpackaged
 * development run.
 */
export type AppFlavor = 'production' | 'beta' | 'local';

/**
 * The version prerelease name of Aiden Beta builds, for example `1.2.5-aidenbeta.42`.
 * electron-updater treats any prerelease name other than `alpha` or `beta` as its own channel,
 * so the production app never offers these builds and Aiden Beta never offers production ones.
 */
export const betaPrerelease = 'aidenbeta';

/**
 * Whether a version belongs to an Aiden Beta build.
 * @param version The app version, such as `app.getVersion()`.
 */
export function isBetaAppVersion(version: string): boolean {
  return new RegExp(`^\\d+\\.\\d+\\.\\d+-${betaPrerelease}\\.\\d+$`).test(version.split('+')[0]!);
}

/**
 * Which copy of Aiden a build is. Beta is decided by the version CI stamps on it; any other
 * packaged build is production, and an unpackaged run is local.
 * @param version The app version.
 * @param packaged Whether the app runs from a packaged build.
 */
export function appFlavor(version: string, packaged: boolean): AppFlavor {
  if (isBetaAppVersion(version)) return 'beta';
  return packaged ? 'production' : 'local';
}

/**
 * Read the flavor the desktop main process hands to the worker as `AIDEN_FLAVOR`. Anything
 * missing or unknown is production, so a stray value can never point a build at beta.
 * @param env The process environment.
 */
export function flavorFromEnv(env: Record<string, string | undefined>): AppFlavor {
  return env.AIDEN_FLAVOR === 'beta' || env.AIDEN_FLAVOR === 'local'
    ? env.AIDEN_FLAVOR
    : 'production';
}

/**
 * Whether this copy of Aiden uses the beta Teams tenant, server, and keychain entries. Aiden Beta
 * does, and so does a local development run, so working on Aiden never signs in to production.
 * @param env The process environment.
 */
export function usesBetaTeams(env: Record<string, string | undefined>): boolean {
  return flavorFromEnv(env) !== 'production';
}
