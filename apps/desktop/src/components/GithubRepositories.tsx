import { GitBranch, Plus, X } from 'lucide-react';
import { type JSX, useState } from 'react';

import type { Project } from '../../../../packages/contracts/src/index';

/** The GitHub repositories already connected to a project, as owner/name. */
export function connectedRepositories(project: Project): string[] {
  return project.repositories.flatMap((repo) => (repo.source ? [repo.source.name] : []));
}

/** Read owner/name from a GitHub link or short name, or null when it is not GitHub. */
export function githubName(input: string): string | null {
  const text = input.trim();
  const match =
    text.match(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i,
    ) ??
    text.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i) ??
    text.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : null;
}

/**
 * The GitHub repositories for a project: paste a link or owner/name to add one, remove any.
 * Aiden keeps its own read-only copy of each, so nothing on this computer needs choosing.
 * Example: pasting https://github.com/acme/web adds "acme/web".
 */
export function GithubRepositories({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  /** Add the pasted repository, ignoring one that is already listed. */
  function add(): void {
    const name = githubName(draft);
    if (!name) {
      setError('Paste a GitHub repository link, such as https://github.com/acme/web.');
      return;
    }
    if (!value.some((item) => item.toLowerCase() === name.toLowerCase()))
      onChange([...value, name]);
    setDraft('');
    setError('');
  }
  return (
    <div className="github-repositories">
      {value.length > 0 && (
        <ul className="project-folder-list" aria-label="GitHub repositories">
          {value.map((name) => (
            <li key={name} className="project-folder">
              <GitBranch size={16} aria-hidden="true" />
              <span className="project-folder-text">
                <strong>{name}</strong>
                <small>github.com/{name}</small>
              </span>
              <button
                className="text-button"
                aria-label={`Remove ${name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item !== name))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="github-add">
        <input
          aria-label="GitHub repository link"
          placeholder="https://github.com/owner/repository"
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button className="secondary" disabled={disabled || !draft.trim()} onClick={add}>
          <Plus size={15} /> Add
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
