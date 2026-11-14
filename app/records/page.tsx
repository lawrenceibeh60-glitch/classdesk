import RecordsManager from "@/components/records-manager"; import {getSession} from "@/lib/auth"; import {redirect} from "next/navigation";
export default async function Page(){const user=await getSession();if(!user)redirect("/login");return <RecordsManager mode="records" isPrimaryAdmin={user.role==="CLASS_REP"}/> }
