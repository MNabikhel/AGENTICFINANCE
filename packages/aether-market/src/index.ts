import { MM_RATE_BAND_E6, type CurrencyCode, type Money } from "@aether/types";

export function fxPayout(fromMinor: number, rateE6: number): number {
  return Math.floor((fromMinor * rateE6) / 1_000_000);
}

export function rateInBand(rateE6: number): boolean {
  return rateE6 >= MM_RATE_BAND_E6.min && rateE6 <= MM_RATE_BAND_E6.max;
}

export function isCatalogSku(sku: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOG, sku);
}

/** True when the catalog lists this SKU in this currency. Unknown SKUs are false. */
export function skuAllowsCurrency(sku: string, currency: CurrencyCode): boolean {
  const row = CATALOG[sku];
  return row !== undefined && row.currencies.includes(currency);
}

export const FX_SKU = "fx.usd_sim.usdc_sim";
export const FX_FROM: CurrencyCode = "USD_SIM";
export const FX_TO: CurrencyCode = "USDC_SIM";

export function isFxSku(sku: string): boolean {
  const row = CATALOG[sku];
  return row !== undefined && row.unit === "fx";
}

/**
 * The sim rail settles USD_SIM → USDC_SIM. Price is in `from`.
 * An FX window on a research SKU, a swapped pair, or a price in `to` is not that window.
 */
export function fxPairSettles(
  sku: string,
  price: Money,
  fx: { from: CurrencyCode; to: CurrencyCode },
): boolean {
  return isFxSku(sku) && price.currency === fx.from && fx.from === FX_FROM && fx.to === FX_TO;
}

export const CATALOG: Record<
  string,
  { description: string; unit: string; currencies: CurrencyCode[] }
> = {
  "data.ticks.2026Q1": {
    description: "Q1 2026 consolidated market ticks",
    unit: "dataset",
    currencies: ["USD_SIM"],
  },
  "compute.gpu.hours": {
    description: "GPU hours for sprint training",
    unit: "hour",
    currencies: ["USD_SIM"],
  },
  "research.brief": {
    description: "Short overnight research brief",
    unit: "report",
    currencies: ["USD_SIM"],
  },
  "research.deep": {
    description: "Deep research package",
    unit: "report",
    currencies: ["USD_SIM"],
  },
  "fx.usd_sim.usdc_sim": {
    description: "USD_SIM to USDC_SIM window (max 200 bps from 1:1)",
    unit: "fx",
    currencies: ["USD_SIM", "USDC_SIM"],
  },
};
