import "./globals.css";

export const metadata = {
  title: "Meta Spend Dashboard",
  description: "Daily Meta ads performance tracking",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
