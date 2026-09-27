// Stable installs follow GitHub's latest stable release. Beta installs also follow pre-releases.
/** Release audience persisted independently of the installed app version. */
export type UpdateChannel = 'stable' | 'beta';

/** Identify a prerelease suffix without treating build metadata as a beta marker. */
export function isPrereleaseVersion(version: string): boolean {
  return version.split('+')[0]!.includes('-');
}

/** Route first-run prerelease installs to beta and other installs to stable. */
export function defaultUpdateChannel(version: string): UpdateChannel {
  return isPrereleaseVersion(version) ? 'beta' : 'stable';
}

/** Validate untrusted preferences without silently selecting a different release audience. */
export function parseUpdateChannel(value: unknown): UpdateChannel | null {
  return value === 'stable' || value === 'beta' ? value : null;
}
