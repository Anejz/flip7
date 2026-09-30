# Flip 7, at your table

A local, three-person version of classic Flip 7. All three people share the screen and take turns using the mouse or keyboard. No accounts, bots, scorekeeper, or backend service.

## Play

```sh
git clone https://github.com/Anejz/flip7.git
cd flip7
npm start
```

Use Node.js 22 or newer. There are no packages to install. Open http://127.0.0.1:4177 in your browser.

## Verify

```sh
npm test
npm run check
```

The `engine.test.js` suite covers the game engine. `critic.test.js` was written independently from the official rules and contains the regression challenges. Tests include 300 complete simulated matches and 30 matches saved and restored at every decision.

`npm run check` also verifies the offline module/assets, browser startup contracts and syntax. For repeatable hands-on checks, open `/?review=rich`, `/?review=target`, `/?review=flip7`, `/?review=bust`, or `/?review=forced`. These visibly labeled scenarios use the real rules engine and never replace your live saved game.

During play, the highlighted hand is on turn. **Space performs the one safe next action**: Hit, continue to the next round, or select the target when only one target is legal. **Esc = Stay** (H / S also work). When several targets are legal, choose a named button. In a dialog, Esc closes it and Space activates an unambiguous primary continuation. There is no handoff confirmation. Scores settle automatically at round end, and both the game and lifetime leaderboard save on this device. Reloading resumes your table. Sound is optional and starts muted.

This table uses one explicit opening house rule: all three players receive one face-up card before any opening Freeze or Flip Three resolves. The rule is deliberate and documented in `RULES.md`.

The draw pile is kept in the same order across rounds. Only when the next draw finds it empty are discarded cards automatically shuffled into a new pile; cards still on the table are excluded. There is no manual shuffle button.

When Second Chance is used, the incoming duplicate and the consumed Second Chance are shown together for 1.2 seconds, then removed together. The original number and score are unchanged. Review this with `/?review=secondchance` or `/?review=secondchance-forced`.

## Rules authority

This game implements revised classic Flip 7, not With a Vengeance or the old first-print Flip Three behavior. The 94-card deck and 200-point target are fixed. See `RULES.md` for details and explicit interpretations.

- [Revised classic rulebook](https://bghub.org/r/flip7.pdf)
- [Publisher FAQ](https://theop.games/pages/flip-7-faqs)
- [Publisher-verified Dized clarifications](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq)

Player names, your current game, and leaderboard results stay in your browser's local storage. They are not sent to a server or included in this repository. Clearing browser data clears your saved table and leaderboard. Local development screenshots and playtest records are excluded from this public repository.

Flip 7 is a game by Eric Olsen, published by The Op Games. This local fan implementation is not affiliated with or endorsed by the publisher.
