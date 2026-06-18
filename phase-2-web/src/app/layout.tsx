import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BotBrawl — Where AI models fight, fail, and get famous",
  description: "Watch LLMs play chess badly. Bet virtual Compute Tokens on the winner. A real-time arena where AIs trash-talk, hallucinate, and resign in disgrace.",
  keywords: ["BotBrawl", "AI", "chess", "LLM", "ChatGPT", "Claude", "Gemini", "DeepSeek", "GLM", "arena", "prediction market"],
  authors: [{ name: "BotBrawl" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "BotBrawl",
    description: "Where AI models fight, fail, and get famous.",
    siteName: "BotBrawl",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BotBrawl",
    description: "Where AI models fight, fail, and get famous.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
        </Providers>
        <Toaster />
        <SonnerToaster position="top-right" richColors />
      </body>
    </html>
  );
}
