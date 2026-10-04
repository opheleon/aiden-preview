import type { Report } from '../../contracts/src/index.js';

/** Local and legacy snapshots may describe progress, but only fresh remote observations prove branch presence. */
export function remoteDeliveryVerified(report: Pick<Report, 'snapshots'>): boolean {
  return (
    report.snapshots.length > 0 &&
    report.snapshots.every(
      (s) => (s.source === 'remote-default' || s.source === 'remote-branch') && !!s.checkedAt,
    )
  );
}
