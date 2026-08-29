import type { Entity } from "@/domain/types";

type GlyphState =
  "observed" | "modeled" | "disputed" | "prevented" | "contained";

export function EntityGlyph({
  entity,
  kind,
  state = "observed",
}: {
  entity?: Entity;
  kind: Entity["kind"];
  state?: GlyphState;
}) {
  const server =
    kind === "endpoint" && /(?:srv|server)/i.test(entity?.label ?? "");
  const serviceAccount =
    kind === "identity" && /^(?:svc|service)[-_]/i.test(entity?.label ?? "");
  const paths: Record<Entity["kind"], React.ReactNode> = {
    identity: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.7-4.1 2.8-6.1 6.5-6.1s5.8 2 6.5 6.1" />
        {serviceAccount ? (
          <path d="M17.2 5.4h3.3v3.3h-3.3zM18.8 8.7v3" />
        ) : null}
      </>
    ),
    session: (
      <>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    network_indicator: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16M12 4c2.4 2.4 3.6 5.1 3.6 8s-1.2 5.6-3.6 8c-2.4-2.4-3.6-5.1-3.6-8S9.6 6.4 12 4Z" />
      </>
    ),
    cloud_role: (
      <>
        <path d="M7 18.5h10.2a3.8 3.8 0 0 0 .6-7.6A6 6 0 0 0 6.3 9.5 4.5 4.5 0 0 0 7 18.5Z" />
        <path d="m10 13 1.4 1.4L15 11" />
      </>
    ),
    secret: (
      <>
        <circle cx="9" cy="10" r="4" />
        <path d="m12 13 7 7M16 17l2-2M14 15l2-2" />
      </>
    ),
    cloud_object: (
      <>
        <path d="M6 3.5h8l4 4V20H6Z" />
        <path d="M14 3.5V8h4M9 12h6M9 15h6" />
      </>
    ),
    endpoint: (
      <>
        {server ? (
          <>
            <rect x="5" y="3.5" width="14" height="17" rx="1.2" />
            <path d="M8 7h8M8 11h8M8 15h4M16 15h.1" />
          </>
        ) : (
          <>
            <rect x="3.5" y="4.5" width="17" height="12" rx="1.5" />
            <path d="M8 20h8M12 16.5V20" />
          </>
        )}
      </>
    ),
    file: (
      <>
        <path d="M6 3.5h8l4 4V20H6Z" />
        <path d="M14 3.5V8h4M9 12h6M9 15h4" />
        <path d="M4 18.5h2M18 18.5h2" />
      </>
    ),
    workload: (
      <>
        <path d="M5 6.5 12 3l7 3.5-7 3.5Z" />
        <path d="m5 11.5 7 3.5 7-3.5M5 16.5l7 3.5 7-3.5" />
        <path d="M3.5 6.5h1M19.5 6.5h1" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="entity-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      data-glyph-state={state}
    >
      {paths[kind]}
      <g className="entity-glyph-state" aria-hidden="true">
        {state === "contained" ? <path d="m8.2 12.4 2.3 2.3 5.4-5.4" /> : null}
        {state === "prevented" ? <path d="M5 19 19 5" /> : null}
        {state === "disputed" ? <path d="M12 7v5M12 16h.01" /> : null}
        {state === "modeled" ? <circle cx="18.2" cy="5.8" r="1.2" /> : null}
      </g>
    </svg>
  );
}
