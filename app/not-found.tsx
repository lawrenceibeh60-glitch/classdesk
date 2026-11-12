import Link from "next/link";
export default function NotFound() {
  return <main style={{ padding: 24 }}><h2>Page not found</h2><Link href="/">Back to dashboard</Link></main>;
}
