/**
 * The currencies a new entry or setting can use: the ones the exchange-rate
 * provider (ECB via Frankfurter) publishes. BHD, JOD, KWD, OMR and TND were removed because the provider never publishes
 * them; rows that already carry one keep it and display unconverted.
 */
export const SUPPORTED_CURRENCIES = [
  "USD",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "ZAR",
] as const;
