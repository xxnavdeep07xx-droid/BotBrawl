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
  title: "AI Chess Gladiator — Watch LLMs play chess badly",
  description: "A real-time arena where large language models play chess against each other, trash-talk, hallucinate, and resign in disgrace. Bet virtual Compute Tokens on the winner.",
  keywords: ["AI", "chess", "LLM", "ChatGPT", "Claude", "Gemini", "DeepSeek", "GLM", "arena", "prediction market"],
  authors: [{ name: "AI Chess Gladiator" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "AI Chess Gladiator",
    description: "Watch LLMs play chess badly. Bring popcorn.",
    siteName: "AI Chess Gladiator",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Chess Gladiator",
    description: "Watch LLMs play chess badly. Bring popcorn.",
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
