import { redirect } from "next/navigation"; import { getSession } from "@/lib/auth"; import AcademicManager from "@/components/academic-manager";
export default async function Page() { const user=await getSession(); if (!user) redirect("/login"); return <AcademicManager mode="attendance" isPrimaryAdmin={user.role==="CLASS_REP"} />; }
