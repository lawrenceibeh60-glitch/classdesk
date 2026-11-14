import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import CalendarView from "@/components/calendar-view";

export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <CalendarView isPrimaryAdmin={user.role === "CLASS_REP"} />;
}
