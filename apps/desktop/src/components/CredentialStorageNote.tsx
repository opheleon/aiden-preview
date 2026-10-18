import type { JSX } from 'react';

/** Explain the scope of a possible OS permission request beside a connection action. */
export function CredentialStorageNote({ connection }: { connection: string }): JSX.Element {
  return (
    <p className="fine-print">
      Your device may ask permission to save or unlock the {connection} sign-in stored by Aiden.
      This request is for that connection’s credentials.
    </p>
  );
}
