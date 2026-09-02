import type { AgentStatus } from "./platform-shell";

export interface StartAccessPresentation {
  label: string;
  detail: string;
  state: AgentStatus["state"];
}

export function getStartAccessPresentation(
  status: AgentStatus,
): StartAccessPresentation {
  if (status.state === "checking") {
    return {
      state: "checking",
      label: "Checking agent access",
      detail: "Registering page-level case access tools.",
    };
  }

  if (status.state === "available") {
    return {
      state: "available",
      label: `TRACE ready · ${status.count} tools available`,
      detail:
        "TRACE is waiting for an analyst task. Case-specific operations register after a workbench opens.",
    };
  }

  if (status.state === "partial") {
    return {
      state: "partial",
      label: `TRACE limited · ${status.count}/${status.total ?? status.count} tools ready`,
      detail:
        "Some page operations did not register. Open a case and review the available capabilities before relying on TRACE.",
    };
  }

  return {
    state: "unavailable",
    label: "TRACE unavailable in this browser",
    detail:
      "The analyst workspace remains available. Open this address in a WebMCP-capable browser to connect TRACE.",
  };
}
