import { StartAccess } from "@/components/start-access";
import { getAllFixtures } from "@/domain/scenarios";

export default function StartPage() {
  return <StartAccess fixtures={getAllFixtures()} />;
}
