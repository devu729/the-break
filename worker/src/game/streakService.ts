/**
 * Streak grading happens inline inside `resolveRound()` in
 * ../db/supabaseAdmin.ts, right after a round's outcome is written — each
 * prediction for that round is graded and the player's streak row is
 * updated in the same pass. It's kept there rather than here so grading and
 * the round-resolution write happen as close together as possible (fewer
 * places for the two to drift out of sync).
 *
 * This file exists as the documented extension point from the repo
 * structure: if streak logic grows (multipliers, weekly resets, badges),
 * pull `applyStreakUpdate` out of supabaseAdmin.ts and into here, and have
 * supabaseAdmin.ts import it instead.
 */
export {};
