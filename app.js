// 1) Replace these two values with your Supabase project details.
const SUPABASE_URL = "https://brlznyvnwlkxifobmhja.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XxD8yRrRjG4EqUT_nUFNTA_-YRQ6VqP";

const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
const db = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
let currentUser = null, profile = null, language = "en", allMonthEvents = [], allProfiles = [], todayShifts = [];

const $ = id => document.getElementById(id);
const labels = {
  clock_in:["Clock In","出勤"], break_start:["Break Start","休憩開始"],
  break_end:["Break End","休憩終了"], clock_out:["Clock Out","退勤"]
};
const fmtTime = v => new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(v));
const fmtDate = v => new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(v));
const jstToday = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const say = (id,msg,ok=false) => { $(id).textContent=msg; $(id).style.color=ok?"#167447":"#a53b36"; };

function setLanguage(){
  document.documentElement.lang=language;
  document.querySelectorAll("[data-en]").forEach(el=>el.textContent=el.dataset[language]);
  $("langToggle").textContent=language==="en"?"日本語":"English";
}
$("langToggle").addEventListener("click",()=>{language=language==="en"?"ja":"en";setLanguage();});

function tick(){
  $("liveClock").textContent=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
  $("todayLabel").textContent=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",weekday:"long",year:"numeric",month:"long",day:"numeric"}).format(new Date())+" · JST";
}
setInterval(tick,1000); tick(); setLanguage();

function showApp(){
  $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); $("logoutBtn").classList.remove("hidden");
  $("welcomeName").textContent=profile.display_name || currentUser.email;
  $("roleLabel").textContent=profile.role==="manager"?"MANAGER PORTAL":"STAFF PORTAL";
  $("staffPanel").classList.toggle("hidden",profile.role==="manager");
  $("managerPanel").classList.toggle("hidden",profile.role!=="manager");
  if(profile.role==="manager") loadManager(); else loadMyEvents();
}
async function loadProfile(){
  const {data,error}=await db.from("profiles").select("*").eq("id",currentUser.id).single();
  if(error||!data){await db.auth.signOut();say("loginMessage","Account profile not found. Ask your manager to finish account setup.");return;}
  profile=data; showApp();
}
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault(); if(!db)return;
  say("loginMessage","Signing in…");
  const {data,error}=await db.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});
  if(error){say("loginMessage",error.message);return;}
  currentUser=data.user; await loadProfile();
});
$("logoutBtn").addEventListener("click",async()=>{if(db)await db.auth.signOut();location.reload();});

async function getGPS(){
  if(!navigator.geolocation) throw new Error("GPS is not supported on this device.");
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(
    p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),
    e=>reject(new Error(e.code===1?"Please allow location access to record attendance.":"Could not get GPS location. Please try again.")),
    {enableHighAccuracy:true,timeout:15000,maximumAge:0}
  ));
}
document.querySelectorAll("[data-action]").forEach(btn=>btn.addEventListener("click",async()=>{
  if(!db||btn.disabled)return;
  const action=btn.dataset.action; btn.disabled=true; say("staffMessage","Getting GPS location…");
  try{
    const gps=await getGPS();
    const {data,error}=await db.rpc("attendance_action",{p_action:action,p_lat:gps.lat,p_lng:gps.lng,p_accuracy:gps.accuracy});
    if(error)throw error;
    say("staffMessage",`${labels[action][0]} recorded at ${fmtTime(data.created_at)} (JST).`,true);
    await loadMyEvents();
  }catch(err){say("staffMessage",err.message||"Could not record attendance.");}
  finally{btn.disabled=false;}
}));

async function loadMyEvents(){
  const {data,error}=await db.from("attendance_events").select("*").eq("staff_id",currentUser.id).eq("is_voided",false).gte("created_at",jstToday()+"T00:00:00+09:00").order("created_at");
  if(error){say("staffMessage",error.message);return;}
  renderMyEvents(data||[]);
}
function renderMyEvents(events){
  const box=$("myEvents");
  if(!events.length){box.innerHTML='<p class="muted">No records yet.</p>';$("statePill").textContent="Not clocked in";$("statePill").className="pill neutral";return;}
  box.innerHTML=events.map(e=>`<div class="event"><span>${labels[e.action]?.[language==="en"?0:1]||e.action}</span><time>${fmtTime(e.created_at)}</time></div>`).join("");
  const last=events[events.length-1].action;
  const states={clock_in:["Clocked in","active"],break_start:["On break","breaking"],break_end:["Clocked in","active"],clock_out:["Clocked out","neutral"]};
  $("statePill").textContent=states[last][0];$("statePill").className="pill "+states[last][1];
  document.querySelectorAll("[data-action]").forEach(b=>{
    const a=b.dataset.action;
    b.disabled=(a==="clock_in"&&last!=="clock_out")||(a==="break_start"&&last!=="clock_in"&&last!=="break_end")||(a==="break_end"&&last!=="break_start")||(a==="clock_out"&&last!=="clock_in"&&last!=="break_end");
  });
}

$("refreshBtn").addEventListener("click",loadManager);
$("monthFilter").value=jstToday().slice(0,7);
$("monthFilter").addEventListener("change",loadMonth);
$("staffFilter").addEventListener("change",renderMonth);
async function loadManager(){
  say("managerMessage","Loading dashboard…",true);
  const [p,e,sh]=await Promise.all([
    db.from("profiles").select("id,display_name,role").eq("role","staff").order("display_name"),
    db.from("attendance_events").select("*").eq("is_voided",false).gte("created_at",jstToday()+"T00:00:00+09:00").order("created_at"),
    db.from("staff_shifts").select("*").eq("shift_date",jstToday())
  ]);
  if(p.error||e.error||sh.error){say("managerMessage",p.error?.message||e.error?.message||sh.error?.message);return;}
  allProfiles=p.data||[]; todayShifts=sh.data||[];
  const shiftSel=$("shiftStaff"); shiftSel.innerHTML=allProfiles.map(x=>`<option value="${x.id}">${escapeHtml(x.display_name)}</option>`).join("");
  $("shiftDate").value=jstToday();
  const sel=$("staffFilter"),old=sel.value;
  sel.innerHTML='<option value="">All staff</option>'+allProfiles.map(x=>`<option value="${x.id}">${escapeHtml(x.display_name)}</option>`).join("");
  sel.value=old;
  renderToday(e.data||[],todayShifts);
  await loadMonth();
  say("managerMessage","Dashboard updated.",true);
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function statusFor(events){
  if(!events.length)return "Not clocked in";
  const last=events[events.length-1].action;
  return last==="clock_in"||last==="break_end"?"Clocked in":last==="break_start"?"On break":"Clocked out";
}
function renderToday(events,shifts=[]){
  const by={};events.forEach(e=>(by[e.staff_id]??=[]).push(e));
  let counts={"Clocked in":0,"On break":0,"Clocked out":0,"Not clocked in":0},late=0;
  $("todayRows").innerHTML=allProfiles.map(p=>{
    const es=by[p.id]||[],st=statusFor(es);counts[st]++;
    const first=es.find(x=>x.action==="clock_in");
    const assigned=shifts.find(x=>x.staff_id===p.id);
    if(first&&assigned){const actual=fmtTime(first.created_at).slice(0,5);if(actual>assigned.shift_start_time.slice(0,5))late++;}
    const last=es[es.length-1],gps=last&&last.latitude!=null?`<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${last.latitude},${last.longitude}">Map</a>`:"—";
    return `<tr><td>${escapeHtml(p.display_name)}</td><td class="status-text">${st}</td><td>${first?fmtTime(first.created_at):"—"}</td><td>${last?labels[last.action][0]+" · "+fmtTime(last.created_at):"—"}</td><td>${gps}</td></tr>`;
  }).join("")||'<tr><td colspan="5">No staff accounts configured.</td></tr>';
  $("statIn").textContent=counts["Clocked in"];$("statBreak").textContent=counts["On break"];$("statOut").textContent=counts["Clocked out"];$("statLate").textContent=late;
}
async function loadMonth(){
  const month=$("monthFilter").value;if(!month)return;
  const start=month+"-01T00:00:00+09:00";
  const [y,m]=month.split("-").map(Number),endDate=new Date(Date.UTC(y,m,1));
  const end=`${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth()+1).padStart(2,"0")}-01T00:00:00+09:00`;
  let q=db.from("attendance_events").select("*").eq("is_voided",false).gte("created_at",start).lt("created_at",end).order("created_at");
  if($("staffFilter").value)q=q.eq("staff_id",$("staffFilter").value);
  const {data,error}=await q;if(error){say("managerMessage",error.message);return;}
  allMonthEvents=data||[];renderMonth();renderCorrectionOptions();
}
function renderMonth(){
  const map=Object.fromEntries(allProfiles.map(p=>[p.id,p.display_name]));
  $("monthRows").innerHTML=allMonthEvents.map(e=>`<tr><td>${fmtDate(e.created_at)}</td><td>${escapeHtml(map[e.staff_id]||"Unknown")}</td><td>${labels[e.action]?.[0]||e.action}${e.is_manual?" · Corrected":""}</td><td>${fmtTime(e.created_at)}</td><td>${e.latitude!=null?`<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${e.latitude},${e.longitude}">Map</a>`:"—"}</td></tr>`).join("")||'<tr><td colspan="5">No records for this month.</td></tr>';
}

$("saveShiftBtn").addEventListener("click", async () => {
  const btn = $("saveShiftBtn");

  try {
    console.log("NEW SAVE SHIFT CODE RUNNING");

    if (!db) {
      say("managerMessage", "Supabase is not connected.");
      return;
    }

    const staffId = $("shiftStaff").value;
    const date = $("shiftDate").value;
    const start = $("shiftStart").value;
    const end = $("shiftEnd").value;

    if (!staffId || !date || !start) {
      say("managerMessage", "Choose staff, date and shift start time.");
      return;
    }

    btn.disabled = true;
    say("managerMessage", "Saving individual shift...", true);

    const { data, error } = await db.rpc("manager_save_shift", {
      p_staff_id: staffId,
      p_shift_date: date,
      p_start: start,
      p_end: end || null
    });

    if (error) {
      console.error("Save Shift Error:", error);
      say("managerMessage", "Shift was not saved: " + error.message);
      return;
    }

    console.log("Shift saved successfully:", data);

    if (date === jstToday()) {
      await loadManager();
    }

    say("managerMessage", "Individual shift saved successfully.", true);

  } catch (err) {
    console.error("Unexpected error:", err);
    say("managerMessage", "Unexpected error: " + (err.message || String(err)));

  } finally {
    btn.disabled = false;
  }
});

if (!configured) {
  $("setupNotice").classList.remove("hidden");
  $("loginForm").querySelector("button").disabled = true;
} else {
  db.auth.getSession().then(({ data }) => {
    if (data.session) {
      currentUser = data.session.user;
      loadProfile();
    }
  });

  db.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      currentUser = null;
      profile = null;
      $("appView").classList.add("hidden");
      $("loginView").classList.remove("hidden");
      $("logoutBtn").classList.add("hidden");
    }
  });
}
