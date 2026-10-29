import './style.css';
export const metadata = { title: 'The Audience', description: 'Your personal social world' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
