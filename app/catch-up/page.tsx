import {isAuthenticated} from "@/lib/auth";import {redirect} from "next/navigation";import AIWorkspace from "@/components/ai-workspace";
export default async function Page(){if(!(await isAuthenticated()))redirect("/login");return <AIWorkspace initialKind="catchup"/>}
