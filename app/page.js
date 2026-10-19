'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let supabase = null
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey)
}

export default function Home() {
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('admin@garment.com')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!supabase) {
      setMsg(`❌ المتغيرات مش واصلة! URL=${!!supabaseUrl} KEY=${!!supabaseKey}`)
      return
    }
    setMsg(`✅ متصل بـ ${supabaseUrl}`)
    supabase.auth.getSession().then(({data}) => setUser(data.session?.user))
  }, [])

  const login = async (e) => {
    e.preventDefault()
    if(!supabase) return alert('Supabase مش متظبط')
    setMsg('جاري تسجيل الدخول...')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMsg('❌ ' + error.message)
        alert(error.message)
      } else {
        setUser(data.user)
        setMsg('✅ تم الدخول')
      }
    } catch (err) {
      setMsg('❌ Failed to fetch - المشروع في Supabase ممكن يكون Paused')
      alert('Failed to fetch - التفاصيل: ' + err.message + '\n\nالحل: روح Supabase > Dashboard شوف لو المشروع Paused دوس Restore')
    }
  }

  if (!user) return (
    <main style={{minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f8fafc', padding:20}}>
      <div style={{background:'white', padding:32, borderRadius:16, width:'100%', maxWidth:400, boxShadow:'0 10px 30px rgba(0,0,0,0.1)'}}>
        <h1 style={{textAlign:'center'}}>🏭 نظام المصنع</h1>
        <p style={{fontSize:11, background:'#fef3c7', padding:8, borderRadius:6, margin:'8px 0', wordBreak:'break-all'}}>{msg}</p>
        <form onSubmit={login} style={{display:'flex', flexDirection:'column', gap:12}}>
          <input value={email} onChange={e=>setEmail(e.target.value)} style={{border:'1px solid #ddd', padding:12, borderRadius:8}} />
          <input type="password" placeholder="الباسورد" value={password} onChange={e=>setPassword(e.target.value)} style={{border:'1px solid #ddd', padding:12, borderRadius:8}} />
          <button style={{background:'#0f172a', color:'white', padding:12, borderRadius:8}}>دخول</button>
        </form>
      </div>
    </main>
  )
  return <div style={{padding:24}}>✅ اهلا {user.email} <button onClick={()=>supabase.auth.signOut().then(()=>setUser(null))}>خروج</button></div>
}
