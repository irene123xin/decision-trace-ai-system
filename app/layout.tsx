import type { Metadata } from "next";
import { CursorIllumination } from "@/components/ui/CursorIllumination";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elsewhere · AI-assisted creative workspace",
  description: "Research prototype for AI-assisted early-stage brand identity design",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><CursorIllumination />{children}</body>
    </html>
  );
}
