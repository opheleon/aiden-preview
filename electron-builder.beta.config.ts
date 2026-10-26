import { readFileSync } from 'node:fs';

import type { Configuration } from 'electron-builder';

import { betaPrerelease } from './packages/contracts/src/app-flavor';

/** The GitHub release feed both apps publish to, as package.json declares it. */
interface GithubFeed {
  provider: 'github';
  owner: string;
  repo: string;
}

// Packaging for Aiden Beta: the production `build` settings from package.json with its own app
// identity, BETA-badged icon, and file names, so it installs next to Aiden instead of over it.
// CI sets the version (for example 1.2.5-aidenbeta.42) with -c.extraMetadata.version.
const { build } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  build: Configuration & { publish: GithubFeed[] };
};

export default {
  ...build,
  appId: 'ai.opheleon.desktop.beta',
  productName: 'Aiden Beta',
  artifactName: 'Aiden-Beta-${version}-${arch}.${ext}',
  // The npm name also names the updater's download cache; production's is opheleon-desktop-app.
  extraMetadata: { name: 'opheleon-desktop-app-beta' },
  mac: { ...build.mac, icon: 'build/app-icon-beta.png' },
  win: { ...build.win, icon: 'build/app-icon-beta.png' },
  // electron-builder only names channels after alpha and beta versions, so the update files
  // (aidenbeta-mac.yml, aidenbeta.yml) must be named explicitly to match the updater.
  publish: build.publish.map((feed) => ({ ...feed, channel: betaPrerelease })),
} satisfies Configuration;
