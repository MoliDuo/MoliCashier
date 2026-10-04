/**
 * What a forecasting model says about one category on one day still to come:
 * how likely it is that anything is spent, and what a day with spending costs.
 * Days are counted from today, so 1 is tomorrow. The simulation only reads
 * models through this, so every model is simulated the same way.
 */
export interface DayModel {
  chance(day: number): number;
  /** An amount for a day with spending, picked by a uniform draw in [0, 1). */
  amount(day: number, draw: number): number;
}
