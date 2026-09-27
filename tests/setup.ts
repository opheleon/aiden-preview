// Keep fixture Git operations independent of runner-installed filters and developer settings.
// Repository-local configuration remains visible so tests exercise production safeguards.
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
