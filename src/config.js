function requireEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function readConfig() {
  return {
    discordToken: requireEnv("DISCORD_TOKEN"),
  };
}

module.exports = {
  readConfig,
  requireEnv,
};
