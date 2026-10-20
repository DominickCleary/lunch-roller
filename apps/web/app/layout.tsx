import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Lunch Roller',
  description: 'Let the wheel decide lunch. A shared workplace lunch game.',
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
