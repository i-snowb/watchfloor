import { AlertWorkspace } from "@/components/alert-workspace";
import { getAllFixtures } from "@/domain/scenarios";

export default function AlertsPage() {
  return <AlertWorkspace fixtures={getAllFixtures()} />;
}
