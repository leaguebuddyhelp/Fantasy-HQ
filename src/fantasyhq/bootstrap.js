const { loadTeams: load2KRatingsTeams } = require("../2kratings/repository");

const TEAM_METADATA = {
  "atlanta-hawks": { abbreviation: "ATL", conference: "East" },
  "boston-celtics": { abbreviation: "BOS", conference: "East" },
  "brooklyn-nets": { abbreviation: "BKN", conference: "East" },
  "charlotte-hornets": { abbreviation: "CHA", conference: "East" },
  "chicago-bulls": { abbreviation: "CHI", conference: "East" },
  "cleveland-cavaliers": { abbreviation: "CLE", conference: "East" },
  "detroit-pistons": { abbreviation: "DET", conference: "East" },
  "indiana-pacers": { abbreviation: "IND", conference: "East" },
  "miami-heat": { abbreviation: "MIA", conference: "East" },
  "milwaukee-bucks": { abbreviation: "MIL", conference: "East" },
  "new-york-knicks": { abbreviation: "NYK", conference: "East" },
  "orlando-magic": { abbreviation: "ORL", conference: "East" },
  "philadelphia-76ers": { abbreviation: "PHI", conference: "East" },
  "toronto-raptors": { abbreviation: "TOR", conference: "East" },
  "washington-wizards": { abbreviation: "WAS", conference: "East" },
  "dallas-mavericks": { abbreviation: "DAL", conference: "West" },
  "denver-nuggets": { abbreviation: "DEN", conference: "West" },
  "golden-state-warriors": { abbreviation: "GSW", conference: "West" },
  "houston-rockets": { abbreviation: "HOU", conference: "West" },
  "los-angeles-clippers": { abbreviation: "LAC", conference: "West" },
  "los-angeles-lakers": { abbreviation: "LAL", conference: "West" },
  "memphis-grizzlies": { abbreviation: "MEM", conference: "West" },
  "minnesota-timberwolves": { abbreviation: "MIN", conference: "West" },
  "new-orleans-pelicans": { abbreviation: "NOP", conference: "West" },
  "oklahoma-city-thunder": { abbreviation: "OKC", conference: "West" },
  "phoenix-suns": { abbreviation: "PHX", conference: "West" },
  "portland-trail-blazers": { abbreviation: "POR", conference: "West" },
  "sacramento-kings": { abbreviation: "SAC", conference: "West" },
  "san-antonio-spurs": { abbreviation: "SAS", conference: "West" },
  "utah-jazz": { abbreviation: "UTA", conference: "West" },
};

function bootstrapTeamsFrom2KRatings() {
  const teams = load2KRatingsTeams();
  if (teams.length !== 30) {
    throw new Error(`Expected 30 current roster teams from 2KRatings, found ${teams.length}.`);
  }

  return teams.map((team) => {
    const metadata = TEAM_METADATA[team.slug];
    if (!metadata) throw new Error(`No conference metadata configured for ${team.slug}.`);
    return {
      teamId: team.slug,
      teamName: team.name,
      abbreviation: metadata.abbreviation,
      conference: metadata.conference,
      assignedUserId: null,
    };
  });
}

module.exports = {
  TEAM_METADATA,
  bootstrapTeamsFrom2KRatings,
};
