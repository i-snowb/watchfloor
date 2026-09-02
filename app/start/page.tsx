import { StartAccess } from "@/components/start-access";
import { getAllFixtures } from "@/domain/scenarios";
import { projectInitialPublicCaseView } from "@/server/public-case-view-only";

export default function StartPage() {
  return (
    <StartAccess
      fixtures={getAllFixtures().map(
        (fixture) => projectInitialPublicCaseView(fixture).fixture,
      )}
    />
  );
}
