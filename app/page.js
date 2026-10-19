'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient('https://zkpmoyavdozbboqxvgys.supabase.co','sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet')

export default function Home(){
const [email,setEmail]=useState('admin@garment.com')
const [pass,setPass]=useState('')
const [user,setUser]=useState(null)
const [loading,setLoading]=useState(false)
const [page,setPage]=useState('dashboard')

const login=async(e)=>{
e.preventDefault()
setLoading(true)
const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
setLoading(false)
if(error){alert(error.message)}else{setUser(data.user)}
}

if(!user){
return(
<main style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',fontFamily:'sans-serif'}}>
<div style={{background:'white',padding:32,borderRadius:16,boxShadow:'0 4px 20px rgba(0,0,0,0.08)',width:360}}>
<h2 style={{textAlign:'center',marginBottom:8}}>نظام ادارة مصنع الملابس</h2>
<p style={{textAlign:'center',fontSize:13,color:'#64748b',marginBottom:20}}>Garment Factory System</p>
<form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:12}}>
<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="الايميل" style={{padding:12,borderRadius:8,border:'1px solid #ddd'}}/>
<input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="كلمة السر" style={{padding:12,borderRadius:8,border:'1px solid #ddd'}}/>
<button disabled={loading} style={{padding:12,borderRadius:8,background:'#0f172a',color:'white',border:'none',cursor:'pointer'}}>{loading?'جاري الدخول...':'دخول'}</button>
</form>
</div>
</main>
)}

return(
<main style={{minHeight:'100vh',background:'#f8fafc',fontFamily:'sans-serif'}}>
<header style={{background:'white',padding:'16px 24px',display:'flex',justifyContent:'space-between',borderBottom:'1px solid #e2e8f0'}}>
<b>نظام المصنع - {user.email}</b>
<button onClick={()=>setUser(null)} style={{padding:'6px 12px',borderRadius:6,border:'1px solid #ddd',background:'white',cursor:'pointer'}}>خروج</button>
</header>
<div style={{display:'flex'}}>
<nav style={{width:220,background:'white',minHeight:'calc(100vh - 60px)',padding:16,borderLeft:'1px solid #e2e8f0'}}>
<div style={{display:'flex',flexDirection:'column',gap:8}}>
<button onClick={()=>setPage('dashboard')} style={{padding:10,textAlign:'right',borderRadius:8,border:'none',background:page==='dashboard'?'#0f172a':'transparent',color:page==='dashboard'?'white':'#334155',cursor:'pointer'}}>لوحة التحكم</button>
<button onClick={()=>setPage('orders')} style={{padding:10,textAlign:'right',borderRadius:8,border:'none',background:page==='orders'?'#0f172a':'transparent',color:page==='orders'?'white':'#334155',cursor:'pointer'}}>الاوردرات</button>
<button onClick={()=>setPage('payroll')} style={{padding:10,textAlign:'right',borderRadius:8,border:'none',background:page==='payroll'?'#0f172a':'transparent',color:page==='payroll'?'white':'#334155',cursor:'pointer'}}>المرتبات والافراد</button>
<button onClick={()=>setPage('inventory')} style={{padding:10,textAlign:'right',borderRadius:8,border:'none',background:page==='inventory'?'#0f172a':'transparent',color:page==='inventory'?'white':'#334155',cursor:'pointer'}}>المخزون</button>
</div>
</nav>
<section style={{flex:1,padding:24}}>
{page==='dashboard' && <div><h2>لوحة التحكم</h2><div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginTop:20}}><div style={{background:'white',padding:20,borderRadius:12}}>اجمالي الاوردرات: 0</div><div style={{background:'white',padding:20,borderRadius:12}}>اجمالي العمال: 0</div><div style={{background:'white',padding:20,borderRadius:12}}>الانتاج اليوم: 0</div></div></div>}
{page==='orders' && <div><h2>ادارة الاوردرات</h2><p style={{color:'#64748b'}}>هنا هنضيف جدول الاوردرات وربطه ب Supabase</p></div>}
{page==='payroll' && <div><h2>المرتبات وشئون العاملين</h2><p style={{color:'#64748b'}}>هنا هنضيف حساب المرتبات والحضور والانصراف</p></div>}
{page==='inventory' && <div><h2>المخزون</h2><p style={{color:'#64748b'}}>هنا هنضيف ادارة الاقمشة والاكسسوارات</p></div>}
</section>
</div>
</main>
)
}
