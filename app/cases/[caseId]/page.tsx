import { notFound } from "next/navigation";
import { CaseWorkbench } from "@/components/case-workbench";
import { ReferenceCaseWorkbench } from "@/components/reference-case-workbench";
import { getReferenceCase } from "@/domain/reference-cases";
import { getCaseFixture } from "@/domain/scenarios";
import { projectInitialPublicCaseView } from "@/server/public-case-view-only";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

export default async function CasePage({ params }: CasePageProps) {
  const { caseId } = await params;
  const fixture = getCaseFixture(caseId);
  if (fixture) {
    return (
      <CaseWorkbench initialView={projectInitialPublicCaseView(fixture)} />
    );
  }
  const referenceCase = getReferenceCase(caseId);
  if (referenceCase) return <ReferenceCaseWorkbench dossier={referenceCase} />;
  notFound();
}
