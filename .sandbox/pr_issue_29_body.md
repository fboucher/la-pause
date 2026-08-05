Fixes #29

### Root Cause
Previously, `stats.streak` was only evaluated when a player won a daily puzzle. If a player missed one or more days without playing, the streak variable remained stale in local storage and was rendered in the UI until the player won a new game. Additionally, win streak details were not rendered on the solved puzzle card, and free/unlimited mode plays lacked explicit isolation from daily win streak calculation logic.

### Summary of Changes
- Added `checkStreakStaleness()` in `public/app.js` to reset `stats.streak` to 0 if `stats.lastWin` is older than yesterday.
- Invoked `checkStreakStaleness()` during application initialization (`init()`) and inside `renderStats()`.
- Updated `recordWin()` to guard against non-daily mode execution so unlimited plays do not increment or reset the daily win streak.
- Enhanced `renderSolved()` to display the active win streak on the solved daily puzzle card.
