'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

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
try{
const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
if(error) throw error
setUser(data.user)
}catch(err){
alert('خطأ: ' + err.message + '\n\nاتأكد ان اليوزر موجود في Supabase')
}
setLoading(false)
}

if(user){
return <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'sans-serif'}}>تم الدخول: {user.email}</div>
}

return(
<main style={{minHeight:'100vh',background:'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'sans-serif'}}>
<div style={{background:'white',padding:32,borderRadius:20,width:360,boxShadow:'0 10px 30px rgba(0,0,0,0.1)',textAlign:'center'}}>
<h2 style={{marginBottom:8}}>🏭 نظام المصنع</h2>
<p style={{fontSize:13,color:'#64748b',marginBottom:20}}>PWA - يتنسطب على الموبايل</p>

<form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:12}}>
<input value={email} onChange={e=>setEmail(e.target.value)} style={{padding:12,borderRadius:10,border:'1px solid #e2e8f0',textAlign:'right'}}/>
<input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={{padding:12,borderRadius:10,border:'1px solid #111827',textAlign:'right'}}/>
<button disabled={loading} style={{padding:12,borderRadius:10,background:'#0f172a',color:'white',border:'none',cursor:'pointer'}}>
{loading?'جاري...':'دخول'}
</button>
</form>

<div style={{marginTop:16,fontSize:11,background:'#fef3c7',padding:10,borderRadius:8,textAlign:'right',lineHeight:1.6}}>
لو لسه معملتش يوزر، روح Supabase {' > '} Authentication {' > '} Add User {' > '} admin@factory.internal
</div>
</div>
</main>
)
}
