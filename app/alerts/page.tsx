import { AlertWorkspace } from "@/components/alert-workspace";
import { getAllFixtures } from "@/domain/scenarios";
import { projectInitialPublicCaseView } from "@/server/public-case-view-only";

export default function AlertsPage() {
  return (
    <AlertWorkspace
      fixtures={getAllFixtures().map(
        (fixture) => projectInitialPublicCaseView(fixture).fixture,
      )}
    />
  );
}
