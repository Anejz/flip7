# Flip 7: implemented classic rules

This game implements the revised **classic Flip 7, Ruleset Edition 3.1**, for three humans sharing one screen. It is not *Flip 7: With a Vengeance*. Rules verified on 2026-08-28.

## Sources and edition differences

- [The Op's revised rulebook, Edition 3.1](https://bghub.org/r/flip7.pdf), both PDF pages / all twelve printed panels: primary rules and card inventory.
- [The Op Games publisher FAQ](https://theop.games/pages/flip-7-faqs): score order, action chooser, mandatory self-targeting when alone, Second Chance timing, and tied games.
- [Publisher-verified Dized FAQ](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/faq): precise forced-draw interruption and initial-deal timing; normal play resumes after the **original drawer** of a passed Flip Three.
- [Dized action-card rules](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/UmFGl-8eR7azrh1huFuZWA/action-cards) and [round cleanup](https://rules.dized.com/game/dPDRM857TU-BFRF7LzGE0g/wzjlmw8LSdeycfWo_EvxOg/starting-the-next-round): played actions stay on the table; current-round held cards never join a mid-round reshuffle.

Older classic printings allowed additional Freeze / Flip Three cards to resolve even after their drawer busted during the forced draws. Edition 3.1 explicitly changes this: those deferred cards are discarded if that forced batch busts. Use the revised rule here. Some early explanations also misstate the deck size or resume play after the recipient of a passed action; neither applies.

The revised booklet includes a one/two-player challenge to reach 200 in as few rounds as possible. This interface intentionally implements the three-player competitive game only.

## 1. Deck

There are 94 uniquely identified cards:

- 79 Number cards: one 0, then N copies of each number N from 1 through 12.
- Six Score Modifiers: one each of +2, +4, +6, +8, +10, and ×2.
- Nine Action cards: three each of Freeze, Flip Three, and Second Chance.

Only Number cards can cause a duplicate bust or count toward seven. Zero counts as a unique Number card but adds no points. Actions never score. There is no visible deck order or probability display.

## 2. Initial deal

The dealer shuffles once at the start of the game. Beginning clockwise to the dealer's left, **every player is dealt exactly one face-up card before any opening action resolves**, including the dealer.

Opening Freeze and Flip Three cards are set aside until all players have their first card, then resolved in reveal order. Second Chance is kept immediately. This is the table's explicit house rule, requested for this shared-screen version; the publisher FAQ instead resolves opening actions immediately. Once ordinary play begins, action timing follows the revised classic rules below.

After the initial deal finishes, the first active player clockwise left of the dealer takes the first ordinary turn.

## 3. Turns and eligibility

Active players take turns clockwise. Hit reveals one card. Stay exits the round and locks the current hand's score; it is legal only when a player has at least one card in front of them. A lone zero, modifier, Second Chance, or resolved Flip Three is sufficient. A player who passed their sole action away and has no cards must Hit.

Stayed, frozen, and busted players receive no further turns and cannot be action targets. An action's drawer chooses its active target, including themself. If only one active player remains, Freeze and Flip Three must target that player.

Passing a Flip Three does **not** move the ordinary turn cursor. After the full action chain, resume clockwise after the player whose normal Hit originally revealed the action, skipping inactive players. Initial-deal actions instead resume the initial deal.

## 4. Bust and Second Chance

A repeated Number value busts its owner, ending their round with zero points. Previous rounds' totals are unaffected. The original hand and the bust-causing duplicate remain out of the recyclable deck until round cleanup.

Second Chance cancels one such duplicate automatically: discard the newly drawn duplicate and the Second Chance, keeping the original number. A normal Hit then ends without a replacement draw. During Flip Three, the duplicate counts as one of the three draws and any remaining forced draws continue.

A newly drawn Second Chance is immediately usable, including later in the same forced batch. A player can hold only one. An extra must be given to another active player without one; if no eligible player exists it is discarded. Second Chance does not protect against Freeze. Unused Second Chances are discarded at round end.

## 5. Freeze and Flip Three

Freeze banks the target's current hand and makes that player inactive. It may freeze an undealt player for zero points. The resolved action stays in front of its target through the round.

Flip Three makes its chosen target accept up to three cards sequentially. **Every** card type counts toward three. A bust stops the batch immediately. Reaching seven unique numbers stops the entire round immediately.

Freeze and further Flip Three cards revealed within the batch are set aside until its three draws succeed. If this batch busts, discard its deferred actions without using them. If it reaches Flip Seven, the round ends and no deferred actions resolve. Second Chance takes effect immediately instead of waiting.

After a successful batch, its drawer assigns the deferred actions. An assigned nested Flip Three resolves fully before returning to the previous batch's remaining effects. A nested recipient's bust cancels only that nested batch's unearned actions; it cannot erase actions already earned by a different, successful batch. The resolved Flip Three card remains in front of its target, outside the recyclable discard.

## 6. Scoring and round end

Exactly seven unique Number cards immediately end the round for everyone and award that player 15 extra points. Modifiers and actions do not help reach seven.

Otherwise, the round ends when there are no active players. Every non-busted player scores their hand, including players still active when somebody else flips seven:

`round score = number sum × (2 with ×2, otherwise 1) + additive modifiers + (15 for Flip Seven)`

×2 does not multiply additive modifiers or the 15-point bonus. Modifier-only hands score their additive points; ×2 alone scores zero. Busted hands score zero regardless of modifiers. Round totals are added exactly once when the round ends.

Victory is checked only then: if anyone has at least 200, the unique highest total wins. A tie at the highest score of 200 or more sends **all** players into another round, including players below 200. Repeat until one player leads.

## 7. Cleanup, dealer rotation, and recycling

At round end, move every current-round card to the side/discard pile. Do not mix it back into the undealt deck. The next dealer is clockwise left of the previous dealer and receives that undealt remainder.

Only when the deck is exhausted, shuffle the discard pile to form the new deck. During a round, held numbers, modifiers, Second Chances, resolved actions, and busted hands (including their duplicate) remain out. Explicitly discarded Second Chance pairs, unassignable extra Second Chances, and cancelled deferred actions may be recycled.

## 8. Explicit implementation conventions

The official sources do not settle every ordering detail. These narrow conventions make the implementation deterministic; they are not presented as quoted publisher rulings:

- When one successful forced batch reveals multiple deferred actions, offer them in reveal order. An assigned nested action completes before returning to remaining parent actions.
- An extra Second Chance revealed during forced draws is given away immediately, then that same forced batch resumes. It still counts as one draw.
- After Flip Seven, ordinary non-busted hand scoring applies to every other player. This follows the rulebook's general scoring procedure, rather than a separate explicit FAQ sentence.

## 9. Engine and verification contract

`engine.js` is DOM-free. Existing mutation APIs remain: `createGame`, `startRound`, `hit`, `stay`, `canStay`, `chooseTarget`, `nextRound`, `roundScoreFor`, `takeEvents`, `buildDeck`, and `makeRng`.

- Each forced batch owns `flip3.queued`; `actionQueue` contains already-earned actions only.
- Players retain `actions` and `bustCard` outside the discard while a round is live.
- At `roundEnd` / `gameOver`, hand arrays are display-only copies of cards already moved to discard. Physical-card conservation excludes these terminal display copies. The next round clears them before dealing.
- `publicSnapshot(game)` contains only face-up state and deck/discard counts. Every event has an independent `snapshot`. `cardResolved` follows each draw's mutation, enabling faithful sequential reveals without showing later cards early.
- `serializeGame(game)` returns versioned JSON, including complete hidden deck state and the current seeded RNG cursor, for local persistence only. Do not render this payload. `restoreGame(json)` resumes at the same decision boundary with an empty event queue. Custom random functions without an exportable cursor cannot be saved.

Run `node --test engine.test.js critic.test.js` for engine verification, or `npm test` for the complete project suite. The engine suite includes precise edge fixtures, 300 seeded complete matches checking all 94 card identities after every decision, independent score arithmetic, and 30 complete matches saved/restored at every decision with identical future draws and final results. The separately authored critic suite preserves regression cases reproduced against the old engine.
