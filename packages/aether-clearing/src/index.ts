import type { AgentId, CurrencyCode } from "@aether/types";

export interface ExposureLeg {
  payer: AgentId;
  payee: AgentId;
  currency: CurrencyCode;
  amount: number;
}

export interface NetPosition {
  agentId: AgentId;
  currency: CurrencyCode;
  /** Positive = others owe this agent. Negative = this agent owes others. */
  net: number;
  grossOut: number;
  grossIn: number;
}

/**
 * Bilateral exposure book. Gross payments accumulate; netting is a view, not a mutation.
 * This is the seed of a CCP: who is exposed to whom, in which currency, right now.
 */
export class ExposureBook {
  private readonly legs: ExposureLeg[] = [];
  readonly defaultBilateralLimit = 50_000_000;

  record(payer: AgentId, payee: AgentId, amount: number, currency: CurrencyCode): void {
    if (amount <= 0) return;
    if (payer === payee) return;
    this.legs.push({ payer, payee, currency, amount });
  }

  gross(payer: AgentId, payee: AgentId, currency: CurrencyCode): number {
    return this.legs
      .filter((l) => l.payer === payer && l.payee === payee && l.currency === currency)
      .reduce((s, l) => s + l.amount, 0);
  }

  /** A→B minus B→A in one currency. Positive means A still owes B on a net basis. */
  pairNet(a: AgentId, b: AgentId, currency: CurrencyCode): number {
    return this.gross(a, b, currency) - this.gross(b, a, currency);
  }

  projected(payer: AgentId, payee: AgentId, currency: CurrencyCode, extra: number): number {
    return this.gross(payer, payee, currency) + extra;
  }

  wouldExceed(
    payer: AgentId,
    payee: AgentId,
    currency: CurrencyCode,
    extra: number,
    limit = this.defaultBilateralLimit,
  ): boolean {
    return this.projected(payer, payee, currency, extra) > limit;
  }

  positions(currency: CurrencyCode): NetPosition[] {
    const ids = new Set<AgentId>();
    for (const l of this.legs) {
      if (l.currency !== currency) continue;
      ids.add(l.payer);
      ids.add(l.payee);
    }
    return [...ids].map((agentId) => {
      const grossOut = this.legs
        .filter((l) => l.payer === agentId && l.currency === currency)
        .reduce((s, l) => s + l.amount, 0);
      const grossIn = this.legs
        .filter((l) => l.payee === agentId && l.currency === currency)
        .reduce((s, l) => s + l.amount, 0);
      return { agentId, currency, net: grossIn - grossOut, grossOut, grossIn };
    });
  }

  /** Compact pairwise nets, omitting zeros. This is what a settlement window would settle. */
  nettingGrid(currency: CurrencyCode): Array<{ from: AgentId; to: AgentId; currency: CurrencyCode; net: number }> {
    const ids = [...new Set(this.legs.filter((l) => l.currency === currency).flatMap((l) => [l.payer, l.payee]))];
    const out: Array<{ from: AgentId; to: AgentId; currency: CurrencyCode; net: number }> = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!;
        const b = ids[j]!;
        const n = this.pairNet(a, b, currency);
        if (n > 0) out.push({ from: a, to: b, currency, net: n });
        if (n < 0) out.push({ from: b, to: a, currency, net: -n });
      }
    }
    return out;
  }

  snapshot() {
    return {
      legs: this.legs,
      usd: {
        positions: this.positions("USD_SIM"),
        netting: this.nettingGrid("USD_SIM"),
      },
      usdc: {
        positions: this.positions("USDC_SIM"),
        netting: this.nettingGrid("USDC_SIM"),
      },
    };
  }
}
