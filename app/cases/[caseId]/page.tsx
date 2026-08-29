import { notFound } from "next/navigation";
import { CaseWorkbench } from "@/components/case-workbench";
import { ReferenceCaseWorkbench } from "@/components/reference-case-workbench";
import { getReferenceCase } from "@/domain/reference-cases";
import { getCaseFixture } from "@/domain/scenarios";

interface CasePageProps {
  params: Promise<{ caseId: string }>;
}

export default async function CasePage({ params }: CasePageProps) {
  const { caseId } = await params;
  const fixture = getCaseFixture(caseId);
  if (fixture) return <CaseWorkbench fixture={fixture} />;
  const referenceCase = getReferenceCase(caseId);
  if (referenceCase) return <ReferenceCaseWorkbench dossier={referenceCase} />;
  notFound();
}
