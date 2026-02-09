import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/providers/AuthProvider";

const plexSans = localFont({
  variable: "--font-plex-sans",
  src: [
    { path: "../assets/fonts/IBMPlexSans-Regular.ttf", weight: "400" },
    { path: "../assets/fonts/IBMPlexSans-Medium.ttf", weight: "500" },
    { path: "../assets/fonts/IBMPlexSans-SemiBold.ttf", weight: "600" },
    { path: "../assets/fonts/IBMPlexSans-Bold.ttf", weight: "700" },
  ],
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "../assets/fonts/IBMPlexMono-Regular.ttf", weight: "400" },
    { path: "../assets/fonts/IBMPlexMono-Medium.ttf", weight: "500" },
    { path: "../assets/fonts/IBMPlexMono-SemiBold.ttf", weight: "600" },
  ],
});

const notoSansTc = localFont({
  variable: "--font-noto-sans-tc",
  src: [
    { path: "../assets/fonts/NotoSansTC-Regular.ttf", weight: "400" },
    { path: "../assets/fonts/NotoSansTC-Medium.ttf", weight: "500" },
    { path: "../assets/fonts/NotoSansTC-Bold.ttf", weight: "700" },
  ],
});

export const metadata: Metadata = {
  title: "Watch",
  description: "Watch log",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${plexSans.variable} ${plexMono.variable} ${notoSansTc.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
