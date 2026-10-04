import type { DayModel } from "./day-model";

/**
 * How many days of the category's overall rate a weekday's own rate is blended
 * with. A weekday seen only a few times in recent weeks says little on its own;
 * this pulls it towards the category's rate until it has been seen more often.
 */
const WEEKDAY_PRIOR_DAYS = 3;

/** Weights this small are a rounding of zero, not a day worth drawing from. */
const NEGLIGIBLE_WEIGHT = 1e-9;

/**
 * The statistical model for one category: whether a day has spending, by
 * weekday, and how much a day with spending costs, drawn from the days that had
 * some. Both read the past through `weights`, so recent days count for more.
 *
 * The amounts are the days themselves rather than a fitted curve: a ledger has
 * a few large days among many small ones, and a curve smooths away exactly the
 * days that decide where a month ends up.
 *
 * `values` holds the category's daily totals; only its first `length` days are
 * read. `firstWeekday` is the weekday of day 0, and `todayWeekday` the weekday
 * of today, the day after the last one read.
 */
export function fitBaselineModel(input: {
  values: Float64Array;
  weights: Float64Array;
  length: number;
  firstWeekday: number;
  todayWeekday: number;
}): DayModel | null {
  const { values, weights, length, firstWeekday, todayWeekday } = input;
  const weekdayWeight = new Float64Array(7);
  const weekdaySpent = new Float64Array(7);
  const amounts: number[] = [];
  const amountWeights: number[] = [];
  let totalWeight = 0;
  let spentWeight = 0;
  for (let day = 0; day < length; day++) {
    const weight = weights[day]!;
    const weekday = (firstWeekday + day) % 7;
    weekdayWeight[weekday] = weekdayWeight[weekday]! + weight;
    totalWeight += weight;
    const value = values[day]!;
    if (value === 0) continue;
    weekdaySpent[weekday] = weekdaySpent[weekday]! + weight;
    spentWeight += weight;
    amounts.push(value);
    amountWeights.push(weight);
  }
  if (amounts.length === 0 || spentWeight <= NEGLIGIBLE_WEIGHT) return null;

  const overall = spentWeight / totalWeight;
  const chanceByWeekday = new Float64Array(7);
  for (let weekday = 0; weekday < 7; weekday++) {
    chanceByWeekday[weekday] =
      (weekdaySpent[weekday]! + WEEKDAY_PRIOR_DAYS * overall) /
      (weekdayWeight[weekday]! + WEEKDAY_PRIOR_DAYS);
  }

  const cumulative = new Float64Array(amounts.length);
  let running = 0;
  for (let index = 0; index < amounts.length; index++) {
    running += amountWeights[index]!;
    cumulative[index] = running;
  }
  const days = Float64Array.from(amounts);

  return {
    chance: (day) => chanceByWeekday[(todayWeekday + day) % 7]!,
    amount: (_day, draw) => days[searchCumulative(cumulative, draw * running)]!,
  };
}

/** The first index whose running weight passes `target`. */
function searchCumulative(cumulative: Float64Array, target: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cumulative[middle]! > target) high = middle;
    else low = middle + 1;
  }
  return low;
}
