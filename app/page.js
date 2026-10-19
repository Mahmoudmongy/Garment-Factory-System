'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

// حطينا القيم الصح مباشرة عشان نتخطى مشكلة Vercel
const supabase = createClient(
  'https://zkpmoyavdozbboqxvgys.supabase.co',
  'sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet'
)

export default function Home(){
  const [email,setEmail]=useState('admin@garment.com')
  const [pass,setPass]=useState('')
  const [loading,setLoading]=useState(false)
  const [user,setUser]=useState(null)

  const login=async(e)=>{
    e.preventDefault()
    setLoading(true)
    const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
    if(error){
      alert('خطأ: '+error.message+'\n\nلو بيقول Invalid login يبقى لازم تنشئ اليوزر في Supabase')
      setLoading(false)
    }else{
      setUser(data.user)
    }
  }

  if(user) return <div style={{padding:40}}>✅ اهلا {user.email} <br/><button onClick={()=>supabase.auth.signOut().then(()=>setUser(null))}>خروج</button></div>

  return(
    <main style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',padding:20}}>
      <div style={{background:'white',padding:32,borderRadius:16,width:'100%',maxWidth:380}}>
        <h2 style={{textAlign:'center'}}>🏭 نظام المصنع</h2>
        <form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:12,marginTop:16}}>
          <input value={email} onChange={e=>setEmail(e.target.value)} style={{border:'1px solid #ddd',padding:12,borderRadius:8}}/>
          <input type="password" placeholder="الباسورد" value={pass} onChange={e=>setPass(e.target.value)} style={{border:'1px solid #ddd',padding:12,borderRadius:8}}/>
          <button disabled={loading} style={{background:'#0f172a',color:'white',padding:12,borderRadius:8}}>{loading?'جاري...':'دخول'}</button>
        </form>
        <p style={{fontSize:11,marginTop:12,background:'#fef3c7',padding:8,borderRadius:6}}>لو قال Invalid login روح Supabase > Authentication > Add User > admin@garment.com</p>
      </div>
    </main>
  )
}
