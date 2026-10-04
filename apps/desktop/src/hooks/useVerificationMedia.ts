import { useEffect, useState } from 'react';

import type { DesktopBridge } from '../bridge';

/** A loaded recording or screenshot: a blob URL once ready, or an error message when it failed. */
export interface VerificationMedia {
  url: string | null;
  error: string;
}

/**
 * Load one file saved by a browser check through the desktop bridge and expose it as a blob URL.
 * The renderer never reads the disk directly: the main process only serves files the saved result
 * names. The URL is revoked when the file changes or the viewer closes. A null file loads nothing,
 * for example an attempt without a proof screenshot.
 */
export function useVerificationMedia(
  api: DesktopBridge | undefined,
  projectId: string,
  runId: string,
  file: string | null,
): VerificationMedia {
  const key = file ? `${projectId}/${runId}/${file}` : '';
  const [loaded, setLoaded] = useState<VerificationMedia & { key: string }>({
    key: '',
    url: null,
    error: '',
  });
  useEffect(() => {
    if (!api || !file) return;
    let cancelled = false;
    let url: string | null = null;
    api.verificationMedia({ projectId, runId, file }).then(
      ({ type, data }) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([data], { type }));
        setLoaded({ key, url, error: '' });
      },
      () => {
        if (!cancelled) setLoaded({ key, url: null, error: 'This file could not be loaded.' });
      },
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, projectId, runId, file, key]);
  // A previous file's URL is never shown for a newly selected one while it loads.
  return loaded.key === key ? loaded : { url: null, error: '' };
}
