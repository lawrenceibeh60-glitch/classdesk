import { isAuthenticated } from "@/lib/auth";
import { redirect } from "next/navigation";
import CoverageView from "@/components/coverage-view";

export default async function Page() {
  if (!(await isAuthenticated())) redirect("/login");
  return <CoverageView />;
}
