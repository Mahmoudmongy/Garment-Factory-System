'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient('https://zkpmoyavdozbboqxvgys.supabase.co','sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet')

export default function Home(){
  const [email,setEmail]=useState('admin@garment.com')
  const [pass,setPass]=useState('')
  const [user,setUser]=useState(null)
  const login=async(e)=>{
    e.preventDefault()
    const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
    if(error){alert(error.message)}else{setUser(data.user)}
  }
  if(user){return <div style={{padding:40}}>اهلا {user.email}</div>}
  return(
    <main style={{padding:40}}>
      <h2>🏭 نظام المصنع</h2>
      <form onSubmit={login}>
        <input value={email} onChange={e=>setEmail(e.target.value)}/><br/><br/>
        <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="الباسورد"/><br/><br/>
        <button>دخول</button>
      </form>
    </main>
  )
}
