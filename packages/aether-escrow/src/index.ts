import { HIRE_TRANSITIONS, type HireContract, type HireState } from "@aether/types";

export function canTransition(from: HireState, to: HireState): boolean {
  return HIRE_TRANSITIONS[from].includes(to);
}

export function transitionHire(hire: HireContract, to: HireState): HireContract {
  if (!canTransition(hire.state, to)) {
    throw Object.assign(new Error(`HIRE_ILLEGAL_TRANSITION ${hire.state} -> ${to}`), {
      code: "HIRE_ILLEGAL_TRANSITION",
    });
  }
  return { ...hire, state: to };
}
