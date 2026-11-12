import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorker from "@/components/service-worker";
export const metadata: Metadata = { title: "AFIT ClassDesk", description: "Private academic coordination workspace for AFIT ND1 Electrical/Electronics Engineering Technology.", applicationName: "AFIT ClassDesk", manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg" } };
export const viewport: Viewport = { themeColor: "#07111f", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body><ServiceWorker />{children}</body></html>; }
