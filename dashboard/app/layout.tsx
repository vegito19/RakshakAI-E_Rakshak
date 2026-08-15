import React from 'react';
import './globals.css';

export const metadata = {
  title: 'Rakshak AI - Law Enforcement OSINT Command Center',
  description: 'Multilingual AI-Powered OSINT & Threat Intelligence Platform for Law Enforcement Agencies',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[#111010] text-[#E8E4DC] font-sans antialiased selection:bg-[#C9A961] selection:text-[#111010]" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
