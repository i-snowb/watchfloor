import type { InvestigationQueryDefinition } from "@/domain/types";
import { formatUtcTime } from "@/lib/format";
import type { TraceSelection } from "./trace-interaction";

interface QueryReturnedRecordsProps {
  onSelect: (selection: TraceSelection) => void;
  query: InvestigationQueryDefinition;
}

export function QueryReturnedRecords({
  onSelect,
  query,
}: QueryReturnedRecordsProps) {
  const scanned = query.sourceScopes.reduce(
    (total, scope) => total + scope.syntheticRecordCount,
    0,
  );

  return (
    <details className="query-returned-records">
      <summary>
        <span>Source records</span>
        <strong>{query.returnedRecords.length}</strong>
        <small>
          of {query.matchedRecordCount} matched · {formatCount(scanned)}{" "}
          searched
        </small>
      </summary>
      <div className="query-returned-records-body">
        <p>Exact fields returned by this investigation.</p>
        <ol>
          {query.returnedRecords.map((record) => {
            const entityId = record.entityIds[0] ?? null;
            return (
              <li key={record.id}>
                <details className="query-returned-record">
                  <summary>
                    <time dateTime={record.timestamp}>
                      {formatUtcTime(record.timestamp)}
                    </time>
                    <span>{record.sourceLabel}</span>
                    <strong>{record.recordType}</strong>
                  </summary>
                  <div>
                    <dl>
                      {record.fields.map((field) => (
                        <div key={`${record.id}-${field.label}`}>
                          <dt>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {entityId ? (
                      <button
                        onClick={() =>
                          onSelect({ kind: "entity", id: entityId })
                        }
                        type="button"
                      >
                        Show in graph
                      </button>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </div>
    </details>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
