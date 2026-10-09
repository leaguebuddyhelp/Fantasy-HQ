# Sportsbook in Discord

Open **MyTeam → SPORTSBOOK**, the weekly announcement, or the Sportsbook button on a live stream post. Markets, player props, specials, straight bets, parlays, wallet, history and leaderboard stay in Discord. There is no website betting page or website betting API. Old website endpoints return `410 Gone` with migration instructions; stored wallets, bets and settlement history are retained.

The private panel shows up to 25 market choices per page. Choose a line to add it to the slip; choose it again to remove it. Use Previous/Next for more lines. Review Wager opens an amount form, then displays exact odds, stake, potential profit and total return. Confirm within five minutes. Confirmation checks current Coach role and ownership, current odds, balance and game lock. Double confirmation records one wager. Restarting the bot expires unfinished slips; persisted confirmation receipts and placed bets survive.

Wallet & Bets is visible only to the coach. Team role and owner assignment must match on every interaction. Coaches cannot bet on their own team, game or players. Game Streamlink submission locks wagering. Money is fictional league currency, with a $300 initial career balance. Straight wagers are $1–$50, parlays $1–$25 with at most five different market selections.

The Staff channel has a **Sportsbook Staff Review** pin. Commish, Assistant Commish or Manage Server users can review the ledger and corrected payouts privately. Review a correction, then explicitly confirm it. Previously spent winnings become recorded debt; future credits repay that debt. Original settlements remain available, and duplicate confirmations apply once. Changed evidence, wallets or expired previews require another review.

Source changes are prepared on the repair branch. Live pins and previously delivered announcement controls update only when an authorized deployment runs reconciliation. No live Discord changes were made during this repair.
