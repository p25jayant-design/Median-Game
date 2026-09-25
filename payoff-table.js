// Payoff table transcribed from the course handout.
// Rows = "Your Choice" (1-14), Columns = "Median Choice" (1-14).
// DEFAULT_PAYOFF_TABLE[choice - 1][median - 1] = payoff for that round.
//
// Note: the bottom-right cell (choice 14, median 14) was on a torn edge of the
// photographed sheet and is a best estimate (12.0) — the instructor can correct
// it in the Admin > Edit Payoff Table screen before the game starts.
export const DEFAULT_PAYOFF_TABLE = [
  /* choice 1  */ [4.5, 4.9, 5.2, 5.5, 5.6, 5.5, 4.6, -5.9, -8.8, -10.5, -11.7, -12.7, -13.5, -14.2],
  /* choice 2  */ [4.8, 5.3, 5.8, 6.2, 6.5, 6.6, 6.1, -2.7, -5.2, -6.7, -7.7, -8.6, -9.2, -9.8],
  /* choice 3  */ [4.8, 5.4, 6.0, 6.6, 7.0, 7.4, 7.2, 0.1, -2.0, -3.2, -4.1, -4.8, -5.3, -5.8],
  /* choice 4  */ [4.3, 5.1, 5.8, 6.5, 7.1, 7.7, 8.0, 2.6, 0.8, -0.2, -0.9, -1.4, -1.9, -2.2],
  /* choice 5  */ [3.5, 4.4, 5.2, 6.0, 6.9, 7.7, 8.3, 4.6, 3.2, 2.5, 1.9, 1.5, 1.2, 1.0],
  /* choice 6  */ [2.3, 3.3, 4.2, 5.2, 6.2, 7.2, 8.2, 6.2, 5.3, 4.7, 4.3, 4.1, 3.9, 3.8],
  /* choice 7  */ [0.7, 1.8, 2.8, 4.0, 5.1, 6.4, 7.8, 7.5, 6.9, 6.6, 6.4, 6.3, 6.2, 6.2],
  /* choice 8  */ [-1.3, -0.1, 1.1, 2.3, 3.7, 5.1, 6.9, 8.3, 8.1, 8.0, 8.0, 8.0, 8.1, 8.2],
  /* choice 9  */ [-3.7, -2.4, -1.1, 0.3, 1.8, 3.5, 5.7, 8.8, 8.9, 9.1, 9.2, 9.4, 9.6, 9.8],
  /* choice 10 */ [-6.5, -5.1, -3.7, -2.1, -0.4, 1.5, 4.0, 8.9, 9.4, 9.8, 10.1, 10.4, 10.7, 11.0],
  /* choice 11 */ [-9.7, -8.2, -6.6, -4.9, -3.1, -0.9, 2.0, 8.5, 9.4, 10.0, 10.5, 11.0, 11.4, 11.9],
  /* choice 12 */ [-13.3, -11.7, -10.0, -8.2, -6.1, -3.7, -0.5, 7.8, 9.1, 9.9, 10.6, 11.2, 11.8, 12.3],
  /* choice 13 */ [-17.3, -15.6, -13.7, -11.8, -9.6, -6.9, -3.3, 6.7, 8.3, 9.4, 10.3, 11.0, 11.7, 12.3],
  /* choice 14 */ [-21.7, -19.8, -17.9, -15.8, -13.4, -10.5, -6.5, 5.2, 7.2, 8.5, 9.5, 10.4, 11.2, 12.0],
];

export const MIN_CHOICE = 1;
export const MAX_CHOICE = 14;

/** Look up a payoff. `table` is a 14x14 array like DEFAULT_PAYOFF_TABLE. */
export function getPayoff(table, choice, medianColumn) {
  const c = clampChoice(choice);
  const m = clampChoice(medianColumn);
  return table[c - 1][m - 1];
}

export function clampChoice(n) {
  return Math.min(MAX_CHOICE, Math.max(MIN_CHOICE, Math.round(n)));
}

/**
 * Given an array of raw numeric choices (any length), compute the median and
 * round it to the nearest whole payoff-table column (round-half-up), clamped
 * to [MIN_CHOICE, MAX_CHOICE].
 * Returns { rawMedian, medianColumn }.
 */
export function computeMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let rawMedian;
  if (n === 0) {
    rawMedian = null;
  } else if (n % 2 === 1) {
    rawMedian = sorted[(n - 1) / 2];
  } else {
    rawMedian = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  }
  const medianColumn = rawMedian === null ? null : clampChoice(Math.round(rawMedian));
  return { rawMedian, medianColumn };
}
