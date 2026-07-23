import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'Twin Visit Logger',
  description: 'Twin Home Buyer — property visit pipeline dashboard',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
