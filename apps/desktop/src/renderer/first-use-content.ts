/** Marketing-led introduction with practical setup details for the shipped Preview app. */
export const firstUseSteps = [
  {
    title: 'Meet Aiden',
    summary: 'Your first autonomous project manager.',
    points: [
      'You set the intent, make the calls, and accept the outcome.',
      'Aiden keeps track of what done means, where it stands, when it will land, and what’s in the way.',
    ],
    detail:
      'Take project management off your plate. Aiden Preview is your own AI project manager, on your Mac, with your Claude or ChatGPT subscription. Start with one project; Aiden writes down what done means, checks the work, and shows what needs your attention.',
  },
  {
    title: 'Bring your own subscription',
    summary: 'Use Aiden with your Claude or ChatGPT account.',
    points: [
      'Open Settings → Model and choose Codex for ChatGPT, or Claude.',
      'Follow the setup steps to install the provider and sign in with your existing account.',
    ],
    detail:
      'Choose the model and effort for your project in Model settings. Aiden uses the subscription or API-key billing option you select. Provider limits and charges may apply. There is no separate Aiden sign-in. You can connect Linear later in Settings → Integrations. It’s optional.',
  },
  {
    title: 'Set the intent',
    summary: 'Start from a customer call, a brief, or a sentence.',
    points: [
      'Tell Aiden what you’re building, choose the project folder, and select Hand it to Aiden.',
      'Aiden writes down what done means in plain language and plans the work in usable steps.',
    ],
    detail:
      'Choose the branch to follow in Settings → Project → Branch monitoring. It starts with your current branch’s remote upstream or the same-named remote branch. Aiden checks pushed code; local edits stay on your computer. To use Linear, open Publishing settings, choose your connection and team, then Create project and publish tickets. Aiden writes the tickets and keeps them in a separate Linear project for this project.',
  },
  {
    title: 'Make the calls',
    summary: 'Keep the calls that need judgment.',
    points: [
      'Aiden brings questions to Needs you. Answer the question to keep the affected work moving.',
      'Change the scope as you learn. Aiden checks again and updates where the project stands.',
    ],
    detail:
      'Start in Overview for progress, what’s left, and what’s in the way. Scope holds what done means, Activity shows what changed, and Runs has check details. While Preview is open, Aiden watches the selected remote branch and ticket status every minute and checks each morning. Use Run check now whenever you need a fresh answer. Reconnect an unavailable tracker in Settings → Integrations, then use Sync tickets.',
  },
  {
    title: 'Accept the outcome',
    summary: 'Know where it stands without asking.',
    points: [
      'See what works, what’s left, and what needs another look.',
      'Review the checks and available recordings, then decide whether the result is ready.',
    ],
    detail:
      'Delivery attention shows where the work differs from what you asked for. Code on the selected branch, app or API checks, and ticket status each tell you something different. Closing a ticket doesn’t verify the result, and code progress doesn’t close tickets. Unavailable checks stay unverified; a merge or deployment needs its own evidence. Select Got it to finish this introduction. You can revisit it through Help / Getting started.',
  },
];
