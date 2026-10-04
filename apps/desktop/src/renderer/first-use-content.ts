/** Informational guide content, kept separate from actions and provider credentials. */
export const firstUseSteps = [
  {
    title: 'Meet Aiden',
    summary: 'Turn an idea into a delivery plan you can follow.',
    points: [
      'You set the scope, answer decisions, and accept the outcome.',
      'Aiden organizes requirements, checks evidence, and surfaces what needs you.',
    ],
    detail:
      'You stay in control of your projects. Reading this guide starts no model work and changes no provider or tracker settings. You can return through Help / Getting started at any time.',
  },
  {
    title: 'Connect your model',
    summary: 'Use your existing Codex or Claude account.',
    points: [
      'Open Settings → Model to install the provider runtime and sign in.',
      'Keep your intended subscription or API-key billing choice. Linear is optional.',
    ],
    detail:
      'Aiden has no separate account sign-in. Choose the provider, model, and effort for the project. To use Linear, connect it in Settings → Integrations; one publishing connection can serve several projects. Viewing this guide never installs, signs in, or connects anything.',
  },
  {
    title: 'Set up a project',
    summary: 'Describe the outcome and choose the folder containing its code.',
    points: [
      'Select Hand it to Aiden to generate requirements and a plan of testable delivery steps.',
      'Choose the remote branch in Settings → Project → Branch monitoring.',
    ],
    detail:
      'The branch starts with your current branch’s upstream, or its same-named remote branch. Local, unpushed work is not remote delivery evidence. For optional Linear tickets, open Publishing settings, select your connection and team, then Create project and publish tickets. Each Aiden project gets its own Linear project; requirements link to their delivery ticket(s).',
  },
  {
    title: 'Keep work moving',
    summary: 'Start with Overview and the items that need your attention.',
    points: [
      'Use Scope to refine the outcome, Activity for changes, and Runs for check details.',
      'Answer blockers to unlock affected work. Use More → Run check now for a fresh assessment.',
    ],
    detail:
      'Scope changes start another check. While the desktop app is open, Aiden watches the selected remote branch and tracker status every minute and also checks each morning. For tracker trouble, reconnect the existing connection in Settings → Integrations, then use Sync tickets on the project. Missing decisions block affected work and its dependents; independent investigation may continue.',
  },
  {
    title: 'Know what is verified',
    summary: 'Code, acceptance checks, and ticket status tell different parts of the story.',
    points: [
      'Remote code progress does not prove app behavior or deployment. Review the linked evidence.',
      'Closing a ticket does not prove completion. Delivery attention surfaces mismatches and unverified work.',
    ],
    detail:
      'App and API acceptance need accessible checks. Missing repository, tracker, app, API, or deployment access stays unverified. Aiden does not automatically prove GitHub Actions or deployments, or close tickets when code appears. Got it remembers this guide in this local workspace; Later or Escape brings it back on the next app launch. Ordinary app upgrades do not reset confirmation.',
  },
];
