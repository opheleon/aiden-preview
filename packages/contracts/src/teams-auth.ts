/** Where Teams sign-in happens. All public values: a native app has no client secret. */
export interface TeamsAuthConfig {
  /** Auth0 tenant issuer, with its trailing slash. */
  issuer: string;
  /** The Aiden Desktop native application. */
  clientId: string;
  /** The Aiden Teams API that access tokens are issued for. */
  audience: string;
  /** Loopback ports registered as callback addresses, tried in order. */
  ports: number[];
}

/** The production tenant. Development can point elsewhere with AIDEN_AUTH0_* variables. */
const defaults: TeamsAuthConfig = {
  issuer: 'https://dev-cbrv8iirno3wazcy.us.auth0.com/',
  clientId: 'gCnSmIYnuG6Gq3HE1I2qV5hY5C2TqkLa',
  audience: 'https://teams.api.opheleon.com',
  ports: [53682, 53683],
};

/** Read the sign-in settings; the issuer must be HTTPS so tokens never cross the network in the clear. */
export function teamsAuth(env: Record<string, string | undefined> = {}): TeamsAuthConfig {
  const issuer = env.AIDEN_AUTH0_ISSUER || defaults.issuer;
  const url = new URL(issuer);
  if (url.protocol !== 'https:' || !issuer.endsWith('/'))
    throw new Error('The Teams sign-in issuer must be an HTTPS URL ending in /.');
  return {
    issuer,
    clientId: env.AIDEN_AUTH0_CLIENT_ID || defaults.clientId,
    audience: env.AIDEN_AUTH0_AUDIENCE || defaults.audience,
    ports: defaults.ports,
  };
}
