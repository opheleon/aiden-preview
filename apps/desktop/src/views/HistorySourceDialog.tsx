import { Plug } from 'lucide-react';
import React from 'react';

import type {
  WorkerMethod,
  WorkerParams,
  WorkerResult,
} from '../../../../packages/contracts/src/api.js';
import type {
  EstimateOverrides,
  EstimationSnapshot,
  McpConnection,
  McpTool,
  Project,
} from '../../../../packages/contracts/src/index';

interface HistorySourceDialogProps {
  integrations: McpConnection[];
  contextConnectionIds: string[];
  setContextConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  historyDraft: {
    connectionId: string;
    sourceId: string;
    sourceLabel: string;
    historyTool: string;
    sourceArgument: string;
  };
  action: (fn: () => Promise<void>) => Promise<void>;
  setHistoryDraft: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      sourceId: string;
      sourceLabel: string;
      historyTool: string;
      sourceArgument: string;
    }>
  >;
  setIntegrationTools: React.Dispatch<React.SetStateAction<Record<string, McpTool[]>>>;
  integrationTools: Record<string, McpTool[]>;
  call: <K extends WorkerMethod>(method: K, params?: WorkerParams<K>) => Promise<WorkerResult<K>>;
  setDiscoveredSources: React.Dispatch<unknown>;
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  setEstimation: React.Dispatch<React.SetStateAction<EstimationSnapshot | undefined>>;
  setOverrides: React.Dispatch<React.SetStateAction<EstimateOverrides>>;
  overrides: EstimateOverrides;
  setShowHistoryConfig: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: React.Dispatch<React.SetStateAction<string>>;
  discoveredSources: unknown;
}

/** Select a confirmed team and read tool for historical calibration. */
export function HistorySourceDialog(props: HistorySourceDialogProps): React.JSX.Element {
  const {
    integrations,
    contextConnectionIds,
    setContextConnectionIds,
    historyDraft,
    action,
    call,
    setDiscoveredSources,
    project,
    setProject,
    setEstimation,
    setOverrides,
    overrides,
    setShowHistoryConfig,
    setNotice,
    discoveredSources,
  } = props;
  return (
    <section
      className="product-workspace estimate-dialog history-source-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Estimation history"
    >
      <div className="card-heading">
        <div className="section-icon">
          <Plug size={19} />
        </div>
        <div>
          <h2>Estimation history</h2>
          <p>
            Select one confirmed team or workspace. Aiden reads completed work through MCP only.
          </p>
        </div>
      </div>
      <div className="context-connections">
        <span>Project context connections</span>
        {integrations.filter((row) => row.status === 'connected').length ? (
          integrations
            .filter((row) => row.status === 'connected')
            .map((row) => (
              <label key={row.id}>
                <input
                  type="checkbox"
                  checked={contextConnectionIds.includes(row.id)}
                  onChange={(e) =>
                    setContextConnectionIds(
                      e.target.checked
                        ? [...new Set([...contextConnectionIds, row.id])]
                        : contextConnectionIds.filter((id) => id !== row.id),
                    )
                  }
                />{' '}
                {row.name}
              </label>
            ))
        ) : (
          <small>Connect and approve a hosted MCP server in Settings.</small>
        )}
      </div>
      <HistorySourceFields {...props} />
      <div className="button-row">
        <button
          className="secondary"
          disabled={!historyDraft.connectionId || !historyDraft.historyTool}
          onClick={() =>
            void action(async () =>
              setDiscoveredSources(
                (
                  await call('integrationCall', {
                    connectionId: historyDraft.connectionId,
                    tool: historyDraft.historyTool,
                    arguments: {},
                  })
                ).result,
              ),
            )
          }
        >
          Discover choices
        </button>
        <button
          className="primary"
          onClick={() =>
            void action(async () => {
              const sources =
                historyDraft.connectionId && historyDraft.sourceId && historyDraft.historyTool
                  ? {
                      contextConnectionIds,
                      history: {
                        ...historyDraft,
                        sourceLabel: historyDraft.sourceLabel || historyDraft.sourceId,
                      },
                    }
                  : { contextConnectionIds, history: null };
              await call('updateSources', { projectId: project.id, sources });
              setProject({ ...project, sources });
              setEstimation(undefined);
              setOverrides({
                ...overrides,
                comparisons: {},
                historicalPoints: {},
              });
              setShowHistoryConfig(false);
              setNotice('Project estimation source saved. Re-estimate to use it.');
            })
          }
        >
          Save source
        </button>
      </div>
      {discoveredSources !== undefined && (
        <pre className="source-preview">
          {JSON.stringify(discoveredSources, null, 2).slice(0, 12000)}
        </pre>
      )}
      <button className="secondary estimate-close" onClick={() => setShowHistoryConfig(false)}>
        Close
      </button>
    </section>
  );
}

/** Select a connected server, approved history tool, and confirmed source identity. */
function HistorySourceFields(props: HistorySourceDialogProps): React.JSX.Element {
  const {
    historyDraft,
    action,
    setHistoryDraft,
    setIntegrationTools,
    integrationTools,
    call,
    integrations,
  } = props;
  return (
    <>
      <div className="form-grid">
        <label>
          Connection
          <select
            value={historyDraft.connectionId}
            onChange={(e) =>
              void action(async () => {
                const connectionId = e.target.value;
                setHistoryDraft({
                  ...historyDraft,
                  connectionId,
                  historyTool: '',
                });
                if (connectionId)
                  setIntegrationTools({
                    ...integrationTools,
                    [connectionId]: await call('integrationTools', {
                      connectionId,
                    }),
                  });
              })
            }
          >
            <option value="">No history source</option>
            {integrations
              .filter((row) => row.status === 'connected')
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Read tool
          <select
            value={historyDraft.historyTool}
            onChange={(e) => setHistoryDraft({ ...historyDraft, historyTool: e.target.value })}
          >
            <option value="">Select approved tool</option>
            {(integrationTools[historyDraft.connectionId] ?? [])
              .filter((tool) => tool.approved)
              .map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Source argument
          <input
            value={historyDraft.sourceArgument}
            onChange={(e) => setHistoryDraft({ ...historyDraft, sourceArgument: e.target.value })}
          />
        </label>
        <label>
          Confirmed source ID
          <input
            placeholder="Team or workspace ID"
            value={historyDraft.sourceId}
            onChange={(e) => setHistoryDraft({ ...historyDraft, sourceId: e.target.value })}
          />
        </label>
        <label>
          Display name
          <input
            value={historyDraft.sourceLabel}
            onChange={(e) => setHistoryDraft({ ...historyDraft, sourceLabel: e.target.value })}
          />
        </label>
      </div>
    </>
  );
}
