import { cruise } from 'dependency-cruiser';

import configuration from '../../dependency-cruiser.config.js';

const result = await cruise(['apps', 'packages'], {
  ...configuration.options,
  ruleSet: configuration,
  outputType: 'err',
});
if (typeof result.output === 'string') process.stdout.write(result.output);
process.exitCode = result.exitCode;
