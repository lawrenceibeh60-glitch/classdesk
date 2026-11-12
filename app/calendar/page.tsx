import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import CalendarView from "@/components/calendar-view";
export default async function Page() { if (!(await isAuthenticated())) redirect("/login"); return <CalendarView />; }
