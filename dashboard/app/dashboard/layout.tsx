import React from 'react';
import '../globals.css';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#111010] text-[#E8E4DC] font-sans antialiased selection:bg-[#C9A961] selection:text-[#111010]" suppressHydrationWarning>
      {children}
    </div>
  );
}
