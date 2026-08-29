import type { AgentId, CurrencyCode, Instant, SettlementWindow, WindowId } from "@aether/types";

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
 * Bilateral exposure book. Gross payments accumulate; netting is a view until
 * `settleWindow` archives the open book for a currency. Money already moved at
 * escrow — a window is the CCP photo, not a second payment.
 */
export class ExposureBook {
  private readonly legs: ExposureLeg[] = [];
  readonly windows: SettlementWindow[] = [];
  defaultBilateralLimit: number;

  constructor(limit = 50_000_000) {
    this.defaultBilateralLimit = limit;
  }

  record(payer: AgentId, payee: AgentId, amount: number, currency: CurrencyCode): void {
    if (amount <= 0) return;
    if (payer === payee) return;
    this.legs.push({ payer, payee, currency, amount });
  }

  restore(input: { legs: ExposureLeg[]; windows?: SettlementWindow[] }): void {
    this.legs.splice(0, this.legs.length, ...input.legs);
    this.windows.splice(0, this.windows.length, ...(input.windows ?? []));
  }

  settleWindow(input: { id: WindowId; at: Instant; currency: CurrencyCode }): SettlementWindow {
    const open = this.legs.filter((l) => l.currency === input.currency);
    const nets = this.nettingGrid(input.currency);
    const grossVolume = open.reduce((s, l) => s + l.amount, 0);
    const netVolume = nets.reduce((s, n) => s + n.net, 0);
    const window: SettlementWindow = {
      id: input.id,
      currency: input.currency,
      at: input.at,
      nets,
      legsConsumed: open.length,
      grossVolume,
      netVolume,
    };
    const kept = this.legs.filter((l) => l.currency !== input.currency);
    this.legs.splice(0, this.legs.length, ...kept);
    this.windows.push(window);
    return window;
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
      legs: [...this.legs],
      windows: [...this.windows],
      bilateralLimit: this.defaultBilateralLimit,
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
