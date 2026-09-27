import { Link2, Plus } from 'lucide-react';
import React from 'react';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../../packages/contracts/src/api.js';
import type { McpConnection } from '../../../../packages/contracts/src/index';

interface CustomServerFormProps {
  customServer: {
    name: string;
    url: string;
    auth: 'oauth' | 'bearer' | 'none';
    bearer: string;
    clientId: string;
    sessionOnly: boolean;
  };
  setCustomServer: React.Dispatch<
    React.SetStateAction<{
      name: string;
      url: string;
      auth: 'oauth' | 'bearer' | 'none';
      bearer: string;
      clientId: string;
      sessionOnly: boolean;
    }>
  >;
  action: (fn: () => Promise<void>) => Promise<void>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  setIntegrations: React.Dispatch<React.SetStateAction<McpConnection[]>>;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
}

/** Collect connection metadata without persisting entered bearer credentials. */
export function CustomServerForm(props: CustomServerFormProps): React.JSX.Element {
  const { customServer, setCustomServer, action, call, setIntegrations, setNotice } = props;
  return (
    <section className="card custom-server">
      <div className="card-heading">
        <div className="section-icon">
          <Link2 size={19} />
        </div>
        <div>
          <h2>Add MCP server</h2>
          <p>Streamable HTTP with legacy HTTP/SSE fallback. Hosted URLs only.</p>
        </div>
      </div>
      <div className="form-grid">
        <label>
          Name
          <input
            value={customServer.name}
            onChange={(e) => setCustomServer({ ...customServer, name: e.target.value })}
          />
        </label>
        <label>
          Server URL
          <input
            placeholder="https://…"
            value={customServer.url}
            onChange={(e) => setCustomServer({ ...customServer, url: e.target.value })}
          />
        </label>
        <label>
          Authentication
          <select
            value={customServer.auth}
            onChange={(e) =>
              setCustomServer({
                ...customServer,
                auth: e.target.value as CustomServerFormProps['customServer']['auth'],
              })
            }
          >
            <option value="oauth">OAuth</option>
            <option value="bearer">Bearer token</option>
            <option value="none">None</option>
          </select>
        </label>
        {customServer.auth === 'bearer' && (
          <label>
            Bearer token
            <input
              type="password"
              value={customServer.bearer}
              onChange={(e) => setCustomServer({ ...customServer, bearer: e.target.value })}
            />
          </label>
        )}
        {customServer.auth === 'oauth' && (
          <label>
            Client ID (optional)
            <input
              value={customServer.clientId}
              onChange={(e) => setCustomServer({ ...customServer, clientId: e.target.value })}
            />
          </label>
        )}
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={customServer.sessionOnly}
          onChange={(e) => setCustomServer({ ...customServer, sessionOnly: e.target.checked })}
        />{' '}
        Use session-only authentication
      </label>
      <button
        className="secondary"
        onClick={() =>
          void action(async () => {
            const connection = await call('integrationAdd', {
              name: customServer.name,
              provider: 'custom',
              url: customServer.url,
              auth: customServer.auth,
              ...(customServer.auth === 'bearer' ? { bearer: customServer.bearer } : {}),
              ...(customServer.clientId ? { clientId: customServer.clientId } : {}),
              sessionOnly: customServer.sessionOnly,
            });
            setIntegrations(await call('integrations'));
            setCustomServer({
              name: '',
              url: '',
              auth: 'oauth',
              bearer: '',
              clientId: '',
              sessionOnly: false,
            });
            setNotice(`${connection.name} added. Connect it to review its read tools.`);
          })
        }
      >
        <Plus size={14} /> Add server
      </button>
    </section>
  );
}
