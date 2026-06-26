import type { Metadata, Viewport } from "next";
import { ErrorReporter } from "./ErrorReporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Listing Writer — turn photos into eBay listings",
  description:
    "Upload your item photos and get a ready-to-post eBay listing in seconds.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#087F5B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
