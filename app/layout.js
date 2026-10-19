export const metadata = {
  title: 'نظام مصنع الملابس',
  description: 'Garment Factory PWA',
  manifest: '/manifest.json',
  themeColor: '#0f172a'
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body style={{margin:0, fontFamily:'system-ui', background:'#f8fafc'}}>{children}</body>
    </html>
  )
}
