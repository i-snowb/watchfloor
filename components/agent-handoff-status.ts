import type { AgentStatus } from "./platform-shell";

export interface AgentHandoffPresentation {
  ready: boolean;
  detail: string;
}

export function getAgentHandoffPresentation(
  status: AgentStatus,
): AgentHandoffPresentation {
  if (status.state === "available") {
    return {
      ready: true,
      detail:
        "TRACE does not begin on page load. Hand it this case to perform bounded evidence work. Analyst decisions and authorizations remain manual.",
    };
  }

  return {
    ready: false,
    detail:
      "Continue the investigation directly in this workspace. Agent handoff requires a complete tool surface in a WebMCP-capable browser.",
  };
}
