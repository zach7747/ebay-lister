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
  themeColor: "#4CAF50",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
