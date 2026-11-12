import AIWorkspace from "@/components/ai-workspace";import {isAuthenticated} from "@/lib/auth";import {redirect} from "next/navigation";
export default async function Page(){if(!(await isAuthenticated()))redirect("/login");return <AIWorkspace/>}
