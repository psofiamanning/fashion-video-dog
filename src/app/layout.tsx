import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Dog Video Game", description: "Your dog, starring in a short video." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
