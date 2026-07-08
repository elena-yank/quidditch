# Fix: Team Scores Lost When Duels Are Created After Scoring Events

## Bug Description

Goals and snitch catches do not always award points to the team (`score_a`/`score_b` in the `games` table), even though personal stats (`stat_goals_scored`, `stat_snitch_catches`) are correctly recorded in the `participants` table.

## Root Cause

In [`src/game-steps.js`](src/game-steps.js:1834), there is an early return path when duels are created in the post-move phase. This early return saves game state to the database but **omits `score_a` and `score_b`** from the UPDATE query.

The execution flow that triggers the bug:

1. **Scoring event occurs** — either:
   - A pending goal is resolved at lines 1663-1665: `scoreA += 10` / `scoreB += 10`
   - A snitch is caught at lines 1758-1761: `scoreA += 30` / `scoreB += 30`
2. **Personal stats are saved** to the `participants` table (lines 1675-1677 for goals, lines 1786-1790 for snitch)
3. **A duel is created** in the post-move phase (pickup/steal duel, throw_steal duel, hit_bludger duel, or snitch duel)
4. **Early return at line 1834** saves game state but **does NOT save `score_a`/`score_b`**
5. The `scoreA`/`scoreB` local variable increments are **lost forever**

Later, when `buildGameResults()` ([`src/game-logic.js`](src/game-logic.js:130)) reads `score_a`/`score_b` from the DB, the team scores are missing the points from the lost scoring events. However, personal stats (`stat_goals_scored`, `stat_snitch_catches`) are correctly saved, so they appear in the results table.

## Affected Code

### Primary bug location — [`src/game-steps.js:1834-1846`](src/game-steps.js:1834)

```javascript
// Lines 1834-1846 — early return when duels exist
if (anyDuelCreated) {
    await client.query(
      `UPDATE games SET quaffle_holder_id = $2, quaffle_pos = $3,
       quaffle_lock_holder_id = $4, quaffle_lock_step_no = $5, quaffle_steal_cooldown_step_no = $6,
       snitch_pos = $7, snitch_revealed = $8, snitch_caught_by_id = $9, snitch_caught_step_no = $10,
       snitch_reveal_count = $11, snitch_hide_count = $12
       WHERE id = $1`,
      [gameId, qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
       nextSnitchPos, nextSnitchRevealed, nextSnitchCaughtByIdResult, nextSnitchCaughtStepNoResult,
       snitchRevealCount, snitchHideCount]
    );
    return;
}
```

**Missing:** `score_a = $13, score_b = $14` in the SET clause, and `scoreA, scoreB` in the parameters array.

### Not affected — pre-move early return at [`src/game-steps.js:1586-1595`](src/game-steps.js:1586)

The pre-move early return does NOT have this bug because:
- Pre-move throws only set up `pendingGoalResolution` (deferred scoring)
- No actual scoring happens before the pre-move early return
- `pendingGoalResolution` is resolved AFTER movement, which is AFTER this early return

## Fix

Add `score_a` and `score_b` to the UPDATE query in the post-move early return at line 1834-1846.

### Change in [`src/game-steps.js`](src/game-steps.js:1835)

**SQL query** — add `score_a = $13, score_b = $14`:
```sql
UPDATE games SET quaffle_holder_id = $2, quaffle_pos = $3,
 quaffle_lock_holder_id = $4, quaffle_lock_step_no = $5, quaffle_steal_cooldown_step_no = $6,
 snitch_pos = $7, snitch_revealed = $8, snitch_caught_by_id = $9, snitch_caught_step_no = $10,
 snitch_reveal_count = $11, snitch_hide_count = $12,
 score_a = $13, score_b = $14
 WHERE id = $1
```

**Parameters array** — add `scoreA, scoreB`:
```javascript
[gameId, qHolderId, qPos, lockHolderId, lockStepNo, stealCooldownStepNo,
 nextSnitchPos, nextSnitchRevealed, nextSnitchCaughtByIdResult, nextSnitchCaughtStepNoResult,
 snitchRevealCount, snitchHideCount,
 scoreA, scoreB]
```

## Verification

1. **Code review**: Confirm the fix follows the same pattern as `finalizeStep()` at lines 1422-1441, which correctly saves `score_a = $3, score_b = $4`
2. **Existing tests**: Run `test/quaffle-duels.test.js` and `test/quaffle-duel-bot.e2e.test.js` to ensure no regressions
3. **Manual testing**: Create a scenario where a goal is scored AND a duel is created in the same step, then verify team scores are correct