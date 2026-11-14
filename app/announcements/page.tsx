import AnnouncementStudio from "@/components/announcement-studio"; import { getSession } from "@/lib/auth"; import { redirect } from "next/navigation";
export default async function Page() { const user=await getSession(); if (!user) redirect("/login"); return <AnnouncementStudio isPrimaryAdmin={user.role==="CLASS_REP"} />; }
