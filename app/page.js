'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://zkpmoyavdozbbqoxvgygs.supabase.co',
  'sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet'
)

export default function Home() {
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('admin@factory.internal')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({data}) => setUser(data.session?.user))
  }, [])

  const login = async (e) => {
    e.preventDefault()
    setLoading(true)
    const {data, error} = await supabase.auth.signInWithPassword({email, password})
    if(error) alert(error.message)
    else setUser(data.user)
    setLoading(false)
  }

  if(!user) return (
    <main style={{minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div style={{background:'white', padding:32, borderRadius:16, width:'100%', maxWidth:400, boxShadow:'0 10px 30px rgba(0,0,0,0.1)'}}>
        <h1 style={{textAlign:'center', fontSize:24, fontWeight:'bold'}}>🏭 نظام المصنع</h1>
        <p style={{textAlign:'center', color:'#64748b', fontSize:13, margin:'8px 0 20px'}}>PWA - يتسطب على الموبايل</p>
        <form onSubmit={login} style={{display:'flex', flexDirection:'column', gap:12}}>
          <input value={email} onChange={e=>setEmail(e.target.value)} style={{border:'1px solid #ddd', padding:12, borderRadius:8}} />
          <input type="password" placeholder="الباسورد" value={password} onChange={e=>setPassword(e.target.value)} style={{border:'1px solid #ddd', padding:12, borderRadius:8}} />
          <button style={{background:'#0f172a', color:'white', padding:12, borderRadius:8, fontWeight:'bold'}}>{loading?'جاري...':'دخول'}</button>
        </form>
        <div style={{marginTop:16, background:'#fef9c3', padding:12, borderRadius:8, fontSize:12}}>لو لسه معملتش يوزر: روح Supabase &gt; Authentication &gt; Add User &gt; admin@factory.internal</div>
      </div>
    </main>
  )

  return (
    <main style={{padding:16, maxWidth:1000, margin:'0 auto'}}>
      <div style={{background:'white', padding:16, borderRadius:12, display:'flex', justifyContent:'space-between', marginBottom:16}}>
        <div><b>{user.email}</b><br/><span style={{color:'green', fontSize:12}}>● متصل</span></div>
        <button onClick={()=>supabase.auth.signOut().then(()=>setUser(null))} style={{background:'#fee2e2', color:'#dc2626', border:'none', padding:'8px 16px', borderRadius:8}}>خروج</button>
      </div>
      <div style={{background:'white', padding:24, borderRadius:12}}>
        <h2>✅ مبروك! النظام شغال كـ PWA</h2>
        <p style={{fontSize:14, marginTop:8}}>دلوقتي افتح الموقع على الموبايل ودوس من Chrome: <b>⋮ &gt; Add to Home Screen</b><br/>هيظهر كتطبيق مصنع حقيقي.</p>
        <p style={{fontSize:14, marginTop:12, color:'#0f172a', fontWeight:'bold'}}>الخطوة الجاية: نعمل جداول الطلبات والعمال.</p>
      </div>
    </main>
  )
}
