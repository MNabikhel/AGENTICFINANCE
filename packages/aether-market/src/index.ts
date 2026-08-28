import { MM_RATE_BAND_E6, type CurrencyCode } from "@aether/types";

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
