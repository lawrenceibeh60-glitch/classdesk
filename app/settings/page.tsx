import { getSession } from "@/lib/auth"; import { redirect } from "next/navigation"; import SectionShell from "@/components/section-shell"; import Link from "next/link"; import BackupTools from "@/components/backup-tools";
export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "CLASS_REP") redirect("/");
  return <SectionShell title="System settings" description="Inspect system configuration, protect class information and manage backups.">
    <div className="grid"><div className="panel half"><h2>System health</h2><p className="sub">Check configured services without exposing credentials.</p><Link className="btn" href="/api/health" target="_blank">Open health status</Link></div><div className="panel half"><h2>Sign-in security</h2><p className="sub">Each authorised staff account has an independent HttpOnly session. Only the Class Representative can manage system backups and primary-only settings.</p><p className="sub">Never share account passwords or place API keys in browser-visible variables.</p></div></div>
    <div style={{ height: 16 }} /><BackupTools />
    <div className="panel" style={{ marginTop: 16 }}><h2>Privacy and governance</h2><ul className="sub" style={{ lineHeight: 2 }}><li>Only collect student information necessary for class coordination.</li><li>Do not store passwords, payment details, JAMB credentials or sensitive identity documents.</li><li>Attendance is aggregate-only; do not enter student names in attendance summaries.</li><li>Never publish private student records in group announcements.</li><li>AI output is a draft and must be reviewed before distribution.</li><li>This is an independent personal tool, not an AFIT-operated system.</li></ul></div>
  </SectionShell>;
}
