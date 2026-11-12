import { redirect } from "next/navigation"; import { isAuthenticated } from "@/lib/auth"; import AcademicManager from "@/components/academic-manager";
export default async function Page() { if (!(await isAuthenticated())) redirect("/login"); return <AcademicManager mode="lectures" />; }
