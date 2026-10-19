'use client'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
const supabase = createClient('https://zkpmoyavdozbboqxvgys.supabase.co','sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet')
export default function Home(){
const [e,setE]=useState('admin@garment.com')
const [p,setP]=useState('')
const [u,setU]=useState(null)
const login=async(ev)=>{
ev.preventDefault()
const r=await supabase.auth.signInWithPassword({email:e,password:p})
if(r.error)alert(r.error.message)
else setU(r.data.user)
}
if(u)return <div style={{padding:40}}>تم الدخول {u.email}</div>
return <main style={{padding:40}}><h2>نظام المصنع</h2><form onSubmit={login}><input value={e} onChange={x=>setE(x.target.value)}/><br/><br/><input type="password" value={p} onChange={x=>setP(x.target.value)}/><br/><br/><button>دخول</button></form></main>
}
