'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient('https://zkpmoyavdozbboqxvgys.supabase.co','sb_publishable_V4ag5rYVHVfmjXufJeFGgw_7nWGhKet')

export default function GarmentSystem(){
  const [email,setEmail]=useState('admin@garment.com')
  const [pass,setPass]=useState('123456')
  const [user,setUser]=useState(null)
  const [loading,setLoading]=useState(false)
  const [tab,setTab]=useState('dashboard')

  const [orders,setOrders]=useState([
    {id:'ORD-1001',client:'LC Waikiki',model:'تيشيرت بيزك',qty:2000,color:'اسود',status:'قص',delivery:'2026-05-10'},
    {id:'ORD-1002',client:'Defacto',model:'بنطلون جينز',qty:1200,color:'ازرق',status:'تقفيل',delivery:'2026-05-15'},
  ])
  const [workers,setWorkers]=useState([
    {id:1,name:'محمد سعيد',job:'ماكينة سنجر',salary:4500,present:true},
    {id:2,name:'احمد حسن',job:'مقص دار',salary:6000,present:true},
    {id:3,name:'سيد علي',job:'جودة',salary:4000,present:false},
  ])
  const [fabrics,setFabrics]=useState([
    {id:1,name:'قطن 100%',stock:850,unit:'كجم'},
    {id:2,name:'ليكرا',stock:320,unit:'كجم'},
    {id:3,name:'جينز',stock:1200,unit:'متر'},
  ])

  const login=async(e)=>{
    e.preventDefault()
    setLoading(true)
    const {data,error}=await supabase.auth.signInWithPassword({email,password:pass})
    setLoading(false)
    if(error){alert('خطأ: '+error.message)}else{setUser(data.user)}
  }

  if(!user){
    return(
      <main style={{minHeight:'100vh',background:'#eef2f7',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Tahoma'}}>
        <div style={{background:'white',width:400,padding:36,borderRadius:24,boxShadow:'0 20px 40px rgba(0,0,0,0.08)',textAlign:'center'}}>
          <div style={{fontSize:48,marginBottom:10}}>🏭</div>
          <h2 style={{margin:0}}>نظام ادارة مصنع الملابس</h2>
          <p style={{color:'#64748b',fontSize:13,marginTop:6}}>Garment Factory System - PWA</p>
          <p style={{color:'#94a3b8',fontSize:12,marginBottom:24}}>يتنسطب على الموبايل ويشتغل Offline</p>
          <form onSubmit={login} style={{display:'flex',flexDirection:'column',gap:12,textAlign:'right'}}>
            <label style={{fontSize:12}}>الايميل</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} style={inputStyle}/>
            <label style={{fontSize:12}}>كلمة السر</label>
            <input type="password" value={pass} onChange={e=>setPass(e.target.value)} style={{...inputStyle,borderColor:'#0f172a'}}/>
            <button disabled={loading} style={{marginTop:8,padding:14,background:'#0f172a',color:'white',borderRadius:12,border:'none',fontWeight:'bold',cursor:'pointer'}}>{loading?'جاري الدخول...':'دخول للنظام'}</button>
          </form>
          <div style={{marginTop:16,background:'#fffbeb',border:'1px solid #fde68a',padding:10,borderRadius:10,fontSize:11}}>لو اول مرة: روح Supabase ثم Authentication ثم Add User</div>
        </div>
      </main>
    )
  }

  return(
    <div style={{minHeight:'100vh',background:'#f8fafc',fontFamily:'Tahoma',direction:'rtl'}}>
      <header style={{height:60,background:'white',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px',position:'sticky',top:0,zIndex:10}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}><span style={{fontSize:22}}>🏭</span><b>مصنع الملابس - Demo</b><span style={{background:'#dcfce7',color:'#166534',padding:'2px 8px',borderRadius:20,fontSize:11}}>متصل</span></div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}><span style={{fontSize:12,color:'#64748b'}}>{user.email}</span><button onClick={()=>setUser(null)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'white'}}>خروج</button></div>
      </header>

      <div style={{display:'flex'}}>
        <aside style={{width:260,background:'white',borderLeft:'1px solid #e2e8f0',minHeight:'calc(100vh - 60px)',padding:16}}>
          <Menu active={tab==='dashboard'} onClick={()=>setTab('dashboard')} icon="📊" label="لوحة التحكم" />
          <Menu active={tab==='orders'} onClick={()=>setTab('orders')} icon="📦" label={`الاوردرات (${orders.length})`} />
          <Menu active={tab==='production'} onClick={()=>setTab('production')} icon="✂️" label="متابعة الانتاج" />
          <Menu active={tab==='workers'} onClick={()=>setTab('workers')} icon="👷" label={`العمال (${workers.length})`} />
          <Menu active={tab==='payroll'} onClick={()=>setTab('payroll')} icon="💰" label="المرتبات والاجور" />
          <Menu active={tab==='inventory'} onClick={()=>setTab('inventory')} icon="🧵" label="مخزون القماش" />
          <Menu active={tab==='clients'} onClick={()=>setTab('clients')} icon="🤝" label="العملاء" />
        </aside>

        <main style={{flex:1,padding:24}}>
          {tab==='dashboard' && (
            <>
              <h2 style={{marginTop:0}}>لوحة التحكم</h2>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:16}}>
                <Stat title="اوردرات جارية" value={orders.length} sub="اوردر" color="#0f172a"/>
                <Stat title="اجمالي العمال" value={workers.length} sub="عامل حاضر" color="#0e7490"/>
                <Stat title="انتاج اليوم" value="1,250" sub="قطعة" color="#15803d"/>
                <Stat title="مخزون قماش" value={fabrics.reduce((a,b)=>a+b.stock,0)} sub="كجم" color="#b45309"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:16,marginTop:20}}>
                <div style={card}><h4>الاوردرات الحالية</h4>{orders.map(o=><div key={o.id} style={row}><span><b>{o.id}</b> - {o.client} - {o.model}</span><span style={badge(o.status)}>{o.status}</span></div>)}</div>
                <div style={card}><h4>حضور اليوم</h4>{workers.map(w=><div key={w.id} style={row}><span>{w.name} - {w.job}</span><span style={{color:w.present?'#16a34a':'#dc2626',fontSize:12}}>{w.present?'حاضر':'غائب'}</span></div>)}</div>
              </div>
            </>
          )}

          {tab==='orders' && (
            <>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2>ادارة الاوردرات</h2><button style={btnPrimary} onClick={()=>{const c=prompt('اسم العميل');if(c)setOrders([...orders,{id:'ORD-'+(1000+orders.length+1),client:c,model:'موديل جديد',qty:1000,color:'',status:'جديد',delivery:'2026-06-01'}])}}>+ اوردر جديد</button></div>
              <div style={card}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr style={{background:'#f8fafc'}}><Th>رقم الاوردر</Th><Th>العميل</Th><Th>الموديل</Th><Th>الكمية</Th><Th>اللون</Th><Th>الحالة</Th><Th>التسليم</Th></tr></thead><tbody>{orders.map(o=><tr key={o.id} style={{borderTop:'1px solid #f1f5f9'}}><Td>{o.id}</Td><Td>{o.client}</Td><Td>{o.model}</Td><Td>{o.qty}</Td><Td>{o.color}</Td><Td><span style={badge(o.status)}>{o.status}</span></Td><Td>{o.delivery}</Td></tr>)}</tbody></table></div>
            </>
          )}

          {tab==='production' && (
            <>
              <h2>متابعة خط الانتاج</h2>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:12,marginTop:16}}>
                <Stage title="القص" count={1} color="#fef3c7"/><Stage title="التطريز" count={0} color="#dbeafe"/><Stage title="التقفيل" count={1} color="#dcfce7"/><Stage title="الجودة QC" count={0} color="#fee2e2"/><Stage title="التعبئة" count={0} color="#f3e8ff"/>
              </div>
            </>
          )}

          {tab==='workers' && (
            <>
              <h2>ادارة العمال</h2>
              <div style={card}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr style={{background:'#f8fafc'}}><Th>الاسم</Th><Th>الوظيفة</Th><Th>الراتب</Th><Th>حضور</Th></tr></thead><tbody>{workers.map(w=><tr key={w.id} style={{borderTop:'1px solid #f1f5f9'}}><Td>{w.name}</Td><Td>{w.job}</Td><Td>{w.salary} ج</Td><Td>{w.present?'✅':'❌'}</Td></tr>)}</tbody></table></div>
            </>
          )}

          {tab==='payroll' && (
            <>
              <h2>المرتبات والاجور</h2>
              <div style={card}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}><b>كشف مرتبات مايو 2026</b><span>الاجمالي: {workers.reduce((a,b)=>a+b.salary,0)} جنيه</span></div>
                {workers.map(w=><div key={w.id} style={{...row,background:'#f8fafc',marginBottom:8,borderRadius:8,padding:12}}><span>{w.name} ({w.job})</span><span>الاساسي {w.salary} + اضافي 0 = <b>{w.salary} ج</b></span></div>)}
              </div>
            </>
          )}

          {tab==='inventory' && (
            <>
              <h2>مخزون القماش والخامات</h2>
              <div style={card}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr style={{background:'#f8fafc'}}><Th>الخامة</Th><Th>الرصيد الحالي</Th><Th>الوحدة</Th><Th>الحالة</Th></tr></thead><tbody>{fabrics.map(f=><tr key={f.id} style={{borderTop:'1px solid #f1f5f9'}}><Td>{f.name}</Td><Td>{f.stock}</Td><Td>{f.unit}</Td><Td><span style={{background:f.stock>500?'#dcfce7':'#fee2e2',padding:'2px 8px',borderRadius:20,fontSize:11}}>{f.stock>500?'متوفر':'ناقص'}</span></Td></tr>)}</tbody></table></div>
            </>
          )}

          {tab==='clients' && (
            <><h2>قاعدة العملاء</h2><div style={card}><div style={row}><span><b>LC Waikiki</b> - تركيا</span><span>5 اوردرات</span></div><div style={row}><span><b>Defacto</b> - تركيا</span><span>3 اوردرات</span></div><div style={row}><span><b>Rivan</b> - السعودية</span><span>2 اوردر</span></div></div></>
          )}
        </main>
      </div>
    </div>
  )
}

const Menu=({active,icon,label,onClick})=><button onClick={onClick} style={{width:'100%',display:'flex',gap:10,padding:'12px 12px',borderRadius:10,border:'none',background:active?'#0f172a':'transparent',color:active?'white':'#334155',cursor:'pointer',marginBottom:6,textAlign:'right',fontWeight:active?'bold':'normal'}}><span>{icon}</span>{label}</button>
const Stat=({title,value,sub,color})=><div style={{background:'white',padding:18,borderRadius:14,borderTop:`4px solid ${color}`}}><div style={{fontSize:12,color:'#64748b'}}>{title}</div><div style={{fontSize:26,fontWeight:'bold',marginTop:6}}>{value}</div><div style={{fontSize:11,color:'#94a3b8'}}>{sub}</div></div>
const Stage=({title,count,color})=><div style={{background:'white',padding:16,borderRadius:12,textAlign:'center',border:'1px solid #e2e8f0'}}><div style={{background:color,width:40,height:40,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px',fontWeight:'bold'}}>{count}</div><div>{title}</div></div>
const card={background:'white',padding:16,borderRadius:14,boxShadow:'0 1px 2px rgba(0,0,0,0.04)'}
const row={display:'flex',justifyContent:'space-between',padding:'10px 0'}
const badge=(s)=>({background:s==='جديد'?'#dbeafe':s==='قص'?'#fef3c7':s==='تقفيل'?'#dcfce7':'#f1f5f9',padding:'2px 10px',borderRadius:20,fontSize:11})
const btnPrimary={padding:'10px 16px',background:'#0f172a',color:'white',border:'none',borderRadius:10,cursor:'pointer'}
const inputStyle={padding:12,borderRadius:10,border:'1px solid #e2e8f0'}
const Th=({children})=><th style={{padding:12,textAlign:'right',fontSize:12,color:'#64748b'}}>{children}</th>
const Td=({children})=><td style={{padding:12,fontSize:13}}>{children}</td>
