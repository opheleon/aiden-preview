import { RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import React from 'react';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../../packages/contracts/src/api.js';
import type { McpConnection, McpTool } from '../../../../packages/contracts/src/index';
import { experimentalIntegration } from '../../../../packages/contracts/src/tracker-connections';

interface IntegrationConnectionCardProps {
  connection: McpConnection;
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  setIntegrations: React.Dispatch<React.SetStateAction<McpConnection[]>>;
  setIntegrationTools: React.Dispatch<React.SetStateAction<Record<string, McpTool[]>>>;
  integrationTools: Record<string, McpTool[]>;
  refresh: () => Promise<void>;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
}

/** Review a hosted connection and explicitly approve its available tools. */
export function IntegrationConnectionCard(
  props: IntegrationConnectionCardProps,
): React.JSX.Element {
  const {
    connection,
    action,
    call,
    setIntegrations,
    setIntegrationTools,
    integrationTools,
    refresh,
    setNotice,
  } = props;
  return (
    <section className="card integration-card" key={connection.id}>
      <div className="connection-row">
        <div>
          <strong>{connection.name}</strong>
          {experimentalIntegration(connection) && <span className="muted"> · Experimental</span>}
          <p>{connection.url}</p>
          <small>
            {connection.secureStorage === 'keyring'
              ? 'Sign-in saved securely on this device'
              : connection.secureStorage === 'session'
                ? 'Sign-in lasts until Aiden closes'
                : 'No sign-in required'}
          </small>
        </div>
        <span className={`connection-state ${connection.status === 'connected' ? 'ready' : ''}`}>
          {connection.status.replaceAll('_', ' ')}
        </span>
      </div>
      {connection.message && <p className="muted">{connection.message}</p>}
      <div className="button-row">
        <button
          className="secondary"
          onClick={() =>
            void action(async () => {
              await call('integrationConnect', { connectionId: connection.id });
              setIntegrations(await call('integrations'));
            })
          }
        >
          <RefreshCw size={13} /> Connect / test
        </button>
        <button
          className="secondary"
          onClick={() =>
            void action(async () => {
              const rows = await call('integrationTools', {
                connectionId: connection.id,
              });
              setIntegrationTools({ ...integrationTools, [connection.id]: rows });
              setIntegrations(await call('integrations'));
            })
          }
        >
          <SlidersHorizontal size={13} /> Review tools
        </button>
        <button
          className="icon-button danger"
          aria-label={`Remove ${connection.name}`}
          onClick={() =>
            void action(async () => {
              await call('integrationRemove', { connectionId: connection.id });
              await refresh();
            })
          }
        >
          <Trash2 size={15} />
        </button>
      </div>
      {integrationTools[connection.id] && (
        <div className="tool-review">
          {(integrationTools[connection.id] ?? []).map((tool) => (
            <div key={tool.name} className={`tool-option ${!tool.readOnly ? 'disabled-tool' : ''}`}>
              <input
                id={`tool-${connection.id}-${tool.name}`}
                type="checkbox"
                disabled={!tool.readOnly}
                checked={tool.approved}
                onChange={(event) =>
                  setIntegrationTools({
                    ...integrationTools,
                    [connection.id]: (integrationTools[connection.id] ?? []).map((row) =>
                      row.name === tool.name ? { ...row, approved: event.target.checked } : row,
                    ),
                  })
                }
              />
              <label htmlFor={`tool-${connection.id}-${tool.name}`}>
                <strong>{tool.name}</strong>
                <small>{tool.description || tool.reason}</small>
              </label>
            </div>
          ))}
          <button
            className="primary"
            onClick={() =>
              void action(async () => {
                if (!connection.toolFingerprint) throw new Error('Refresh tool definitions first.');
                await call('integrationApprove', {
                  connectionId: connection.id,
                  fingerprint: connection.toolFingerprint,
                  tools: (integrationTools[connection.id] ?? [])
                    .filter((tool) => tool.approved)
                    .map((tool) => tool.name),
                });
                setIntegrations(await call('integrations'));
                setNotice('Approved read tools saved.');
              })
            }
          >
            Save read tools
          </button>
        </div>
      )}
    </section>
  );
}
