import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Select a project tab by its label, as a person clicking the tab bar. */
export async function selectTab(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name }));
}

/** The project's Chat tab panel; only found while Chat is the selected tab. */
export function chatPanel(): Promise<HTMLElement> {
  return screen.findByRole('tabpanel', { name: 'Chat' });
}
