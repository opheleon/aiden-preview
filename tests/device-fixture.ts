import type { DeviceTarget } from '../packages/contracts/src/device-verification.js';

export const target: DeviceTarget = {
  serverUrl: 'http://127.0.0.1:4723',
  udid: '00008110-0011223344556677',
  bundleId: 'com.example.test',
};
export const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY9kAAAAASUVORK5CYII=';
/** Synthetic Appium HTTP server, with recorded commands and failure controls. No phone is connected. */
export function phoneFixture() {
  const calls: { route: string; method: string; body: any }[] = [];
  const state = {
    installed: true,
    foreground: target.bundleId,
    secure: false,
    ambiguous: false,
    sourceFails: false,
    closeFails: false,
    width: 390,
  };
  const http: typeof fetch = (input, options) => {
    const route = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    ).pathname;
    const body = options?.body ? JSON.parse(options.body as string) : {};
    calls.push({ route, method: options?.method ?? 'GET', body });
    let value: unknown = null;
    if (route === '/session')
      value = {
        sessionId: 'fixture-session',
        capabilities: {
          deviceName: 'Fixture iPhone',
          platformVersion: '18.0',
          platformName: 'iOS',
        },
      };
    if (route.endsWith('/execute/sync')) {
      if (body.script === 'mobile: isAppInstalled') value = state.installed;
      if (body.script === 'mobile: activeAppInfo') value = { bundleId: state.foreground };
    }
    if (route.endsWith('/source'))
      value = state.sourceFails
        ? { error: 'unavailable' }
        : '<Application><Button name="Continue"/></Application>';
    if (route.endsWith('/screenshot')) value = png;
    if (route.endsWith('/elements'))
      value = state.ambiguous ? [] : [{ 'element-6066-11e4-a52e-4f735466cecf': 'element-id' }];
    if (route.endsWith('/attribute/type'))
      value = state.secure ? 'XCUIElementTypeSecureTextField' : 'XCUIElementTypeTextField';
    if (route.endsWith('/window/rect')) value = { width: state.width, height: 844 };
    if (options?.method === 'DELETE' && state.closeFails)
      return Promise.resolve(new Response('', { status: 500 }));
    return Promise.resolve(Response.json({ value }));
  };
  return { calls, state, http };
}
