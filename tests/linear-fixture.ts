import { z } from 'zod/v3';

import { defineTool } from '../packages/tools/src/tool-definition.js';

/** Synthetic Linear project setup and discovery. No customer services are called. */
export function linearFixture() {
  const teams = [
    { id: 'team-books', name: 'Books' },
    { id: 'team-web', name: 'Web' },
  ];
  const projects = new Map<
    string,
    {
      id: string;
      uuid?: string;
      name: string;
      description: string;
      teams: { id: string }[];
      url: string;
    }
  >();
  const calls: string[] = [];
  const behavior = {
    failAfterCreate: false,
    missingSearch: false,
    wrongTeam: false,
    failGet: false,
    incomplete: false,
    teamsError: false,
    splitProjectIds: false,
  };
  const definitions = [
    defineTool({
      name: 'list_teams',
      description: 'Synthetic teams',
      schema: z.object({ limit: z.number().optional(), cursor: z.string().optional() }),
      run: () => {
        calls.push('teams');
        if (behavior.teamsError) throw new Error('Synthetic team failure');
        return { teams, hasNextPage: false };
      },
    }),
    defineTool({
      name: 'list_projects',
      description: 'Synthetic projects',
      schema: z.object({
        query: z.string(),
        team: z.string(),
        limit: z.number().max(50).optional(),
      }),
      run: ({ query, team }) => {
        calls.push('search');
        return {
          projects: behavior.missingSearch
            ? []
            : [...projects.values()].filter(
                (p) => p.name === query && p.teams.some((t) => t.id === team),
              ),
          hasNextPage: behavior.incomplete,
        };
      },
    }),
    defineTool({
      name: 'get_project',
      description: 'Synthetic project read',
      schema: z.object({ query: z.string() }),
      run: ({ query }) => {
        calls.push('get');
        if (behavior.failGet) throw new Error('Synthetic read failure');
        return projects.get(query) ?? [...projects.values()].find((p) => p.uuid === query);
      },
    }),
    defineTool({
      name: 'save_project',
      description: 'Synthetic project creation',
      readOnly: false,
      schema: z.object({
        name: z.string(),
        description: z.string(),
        setTeams: z.array(z.string()),
      }),
      run: ({ name, description, setTeams }) => {
        calls.push('create');
        const id = `project-${projects.size + 1}`;
        projects.set(id, {
          id,
          ...(behavior.splitProjectIds
            ? { uuid: `00000000-0000-4000-8000-${String(projects.size + 1).padStart(12, '0')}` }
            : {}),
          name,
          description,
          teams: (behavior.wrongTeam ? ['foreign-team'] : setTeams).map((id) => ({ id })),
          url: `https://linear.app/fixture/project/${id}`,
        });
        if (behavior.failAfterCreate) throw new Error('Synthetic lost creation reply');
        return projects.get(id)!;
      },
    }),
  ];
  return { teams, projects, calls, behavior, definitions };
}
