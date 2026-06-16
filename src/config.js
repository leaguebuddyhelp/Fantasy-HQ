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
    sleeperUsername: process.env.SLEEPER_USERNAME?.trim() || "",
    sleeperLeagueId: process.env.SLEEPER_LEAGUE_ID?.trim() || "",
    sleeperSeason: process.env.SLEEPER_SEASON?.trim() || new Date().getFullYear().toString(),
  };
}

module.exports = {
  readConfig,
  requireEnv,
};
