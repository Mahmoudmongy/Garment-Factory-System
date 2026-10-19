'use client'
import { useEffect } from 'react'

export default function Page() {
  useEffect(() => {
    window.location.href = '/factory-demo.html'
  }, [])
  return (
    <main style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Tahoma',background:'#f4f5f7'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:40}}>🧵</div>
        <p>جاري تحميل نظام المصنع Demo...</p>
      </div>
    </main>
  )
}
