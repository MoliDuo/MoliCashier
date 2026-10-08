import "./globals.css";
import type { Metadata, Viewport } from "next";
import { textRoleClassName } from "@/components/typography";
import { metadataCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";
import { THEME_COLOR } from "@/lib/theme-colors";

export const metadata: Metadata = {
  title: metadataCopy.title,
  description: metadataCopy.description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, "/favicon.ico", "/icon.png"],
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: metadataCopy.appName,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLOR.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLOR.dark },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // Ensure content extends to edges including notches
  // The on-screen keyboard shrinks the layout viewport, so fixed bars and
  // full-height sheets stay above it instead of under it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactNode {
  // `scroll-behavior: smooth` is set in globals.css; the attribute tells the
  // router it may turn that off for the scroll it performs on navigation, so
  // route changes land where they intend to instead of animating there.
  return (
    <html lang="zh-CN" suppressHydrationWarning data-scroll-behavior="smooth">
      <body data-app="cashier" className="antialiased" style={{ backgroundColor: "var(--bg)" }}>
        <a
          href="#main-content"
          className={textRoleClassName(
            "body",
            "sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[300] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-modal"
          )}
        >
          {commonCopy.skipToContent}
        </a>
        {/* Each page names its own <main id="main-content">: in the ledger that is
            the content below the bars, so the skip link passes them. */}
        <div className="max-w-screen-2xl mx-auto min-h-screen pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
          {children}
        </div>
      </body>
    </html>
  );
}
