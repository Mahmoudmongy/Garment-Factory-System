'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://zkpmoyavdozbboqxvgys.supabase.co',
  'sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet'
)

export default function Page(){
  const [email,setEmail]=useState('admin@garment.com')
  const [pass,setPass]=useState('')
  const [loading,setLoading]=useState(false)
  const [user,setUser]=useState(null)

  const login=async(e)=>{
    e.preventDefault()
    setLoading(true)
    const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
    setLoading(false)
    if(error) alert('خطأ: '+error.message)
    else setUser(data.user)
  }

  if(!user){
    return(
      <main style={{minHeight:'100vh',background:'#eef2f7',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Tahoma'}}>
        <div style={{background:'white',width:390,padding:36,borderRadius:24,boxShadow:'0 20px 40px rgba(0,0,0,0.08)',textAlign:'center'}}>
          <div style={{fontSize:52}}>🏭</div>
          <h2 style={{margin:'10px 0 6px'}}>نظام المصنع</h2>
          <p style={{color:'#64748b',fontSize:13,margin:0}}>PWA - يتنسطب على الموبايل</p>
          <p style={{color:'#94a3b8',fontSize:11,marginBottom:24}}>Garment Factory System - Demo</p>
          
          <form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:12,textAlign:'right'}}>
            <label style={{fontSize:12}}>الايميل</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} style={{padding:12,borderRadius:10,border:'1px solid #e2e8f0'}}/>
            <label style={{fontSize:12}}>كلمة السر</label>
            <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" style={{padding:12,borderRadius:10,border:'1px solid #111827'}}/>
            <button disabled={loading} style={{marginTop:8,padding:14,background:'#0f172a',color:'white',borderRadius:12,border:'none',fontWeight:'bold',cursor:'pointer'}}>
              {loading?'جاري الدخول...':'دخول للنظام'}
            </button>
          </form>

          <div style={{marginTop:16,background:'#fffbeb',border:'1px solid #fde68a',padding:10,borderRadius:10,fontSize:11,textAlign:'center'}}>
            لو لسه معملتش يوزر: Supabase ثم Authentication ثم Add User
          </div>
        </div>
      </main>
    )
  }

  // بعد تسجيل الدخول - يفتح الـ Demo الكامل
  return(
    <div style={{width:'100vw',height:'100vh',position:'relative'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:36,background:'#0f6b5c',color:'white',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 12px',fontFamily:'Tahoma',fontSize:12,zIndex:10}}>
        <span>🏭 مرحبا {user.email} - نسخة Demo كاملة</span>
        <button onClick={()=>setUser(null)} style={{background:'#ffffff30',color:'white',border:'1px solid white',borderRadius:6,padding:'2px 10px',cursor:'pointer'}}>خروج</button>
      </div>
      <iframe
        src="/factory-demo.html"
        style={{width:'100vw',height:'100vh',border:'none',paddingTop:36,boxSizing:'border-box'}}
        title="Factory Demo"
      />
    </div>
  )
}
