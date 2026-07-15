import type { Metadata } from "next";
import { Inter, Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import GlobalMeetingAlert from "@/components/GlobalMeetingAlert";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MeetAI — Meetings, minutes, and momentum",
  description:
    "Host video meetings, organize groups, and get AI-generated minutes automatically. MeetAI keeps your sessions, rooms, and chat in one calm place.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <div aria-hidden="true" className="ambient" />
        {children}
        <GlobalMeetingAlert />
      </body>
    </html>
  );
}
