import {useEffect,useState} from 'react';
import {
  Activity,AlertTriangle,ArrowRight,Bell,Camera,CheckCircle2,ClipboardCheck,Clock3,
  Database,DatabaseBackup,Download,LayoutDashboard,
  Palette,Save,ScanText,Server,ShieldCheck,Truck,Users,Workflow
} from 'lucide-react';
import {Button,Heading} from './UnifiedKit';
import TeamWorkspace from './TeamWorkspace';
import HistoricalImport from './HistoricalImport';
import {ops,type Preferences} from './unifiedOps';
import './settings-control-center.css';

type Tab='overview'|'worker'|'automation'|'users'|'dispatch'|'pdf'|'camera'|'alerts'|'backup'|'security'|'appearance';
const tabs=[
  {id:'overview',label:'Overview',icon:LayoutDashboard},
  {id:'worker',label:'Office Worker',icon:Server},
  {id:'automation',label:'Automation',icon:Workflow},
  {id:'users',label:'Users & Roles',icon:Users},
  {id:'dispatch',label:'Dispatch Rules',icon:Truck},
  {id:'pdf',label:'PDF / OCR',icon:ScanText},
  {id:'camera',label:'Camera & Photos',icon:Camera},
  {id:'alerts',label:'Notifications',icon:Bell},
  {id:'backup',label:'Backup & Recovery',icon:DatabaseBackup},
  {id:'security',label:'Security & Audit',icon:ShieldCheck},
  {id:'appearance',label:'Appearance',icon:Palette},
] as const;

function SectionHeader({title,description,badge}:{title:string;description:string;badge?:string}){
  return <div className='sc-section-head'><div><h2>{title}</h2><p>{description}</p></div>{badge&&<span className='sc-chip'>{badge}</span>}</div>;
}
function Note({children}:{children:any}){return <div className='sc-note'><AlertTriangle size={17}/><div>{children}</div></div>}
function SettingRow({title,description,right}:{title:string;description:string;right?:any}){
  return <div className='sc-setting-row'><div><strong>{title}</strong><p>{description}</p></div>{right&&<span>{right}</span>}</div>;
}
function Status({tone='planned',children}:{tone?:'planned'|'good'|'warning';children:any}){
  return <span className={'sc-status '+tone}><span/>{children}</span>;
}
function Planned({title,items}:{title:string;items:string[]}){
  return <section className='sc-card'><SectionHeader title={title} description='Implementation roadmap — these options are not yet connected to a backend.' badge='PLANNED'/><div className='sc-feature-grid'>{items.map(item=><div className='sc-feature' key={item}><Clock3 size={15}/>{item}</div>)}</div></section>;
}
const PREF_DENSITY='pjs_oms_display_density_v1';

export default function SettingsControlCenter({p}:{p:any}){
  const {authenticated,demo,records,jobs,events,settings,setSettings,userId,activeTeam,onTeamSelect,onRefresh,onNotice,onError,onExport,onGoto}=p;
  const [tab,setTab]=useState<Tab>('overview');
  const [draft,setDraft]=useState<Preferences>(settings);
  const [dirty,setDirty]=useState(false);
  const [saving,setSaving]=useState(false);
  const [density,setDensity]=useState<'comfortable'|'compact'>(()=>{
    try{return localStorage.getItem(PREF_DENSITY)==='compact'?'compact':'comfortable';}catch{return 'comfortable';}
  });
  useEffect(()=>{if(!dirty)setDraft(settings);},[settings,dirty]);
  useEffect(()=>{
    document.documentElement.dataset.omsDensity=density;
    try{localStorage.setItem(PREF_DENSITY,density);}catch{ /* local preferences are optional */ }
  },[density]);
  const valid=Number.isFinite(draft.ebill_threshold)&&draft.ebill_threshold>=0&&draft.ebill_threshold<=100000000
    &&Number.isInteger(draft.retrack_days)&&draft.retrack_days>=1&&draft.retrack_days<=90
    &&Number.isInteger(draft.reminder_days)&&draft.reminder_days>=1&&draft.reminder_days<=90;
  async function saveDispatch(){
    if(demo||!authenticated||saving||!valid||!dirty)return;
    setSaving(true);
    try{
      await ops.updatePreferences(draft);
      setSettings({...draft});
      setDirty(false);
      onNotice('Dispatch rules saved to independent Supabase.');
    }catch(e:any){onError('Settings not saved: '+(e?.message||'Please retry.'));}
    finally{setSaving(false);}
  }
  function change<K extends keyof Preferences>(key:K,value:number){
    setDraft(previous=>({...previous,[key]:value}));
    setDirty(true);
  }
  function switchTab(t:Tab){setTab(t);window.scrollTo({top:0,behavior:'smooth'});}
  const waiting=jobs.filter((j:any)=>j.status==='queued').length;
  const failed=jobs.filter((j:any)=>j.status==='failed').length;
  return <div className='sc-root'>
    <Heading eyebrow='ADMINISTRATION / INDEPENDENT WORKSPACE' title='Settings Control Center'
      description='Manage operations safely. Active settings are separated from planned integrations; existing cloud records stay unchanged.'/>
    <div className='sc-hero'>
      <div><strong><ShieldCheck size={17}/> Independent OMS</strong><p>Protected cloud workspace. The original PJS Delivery Control database is not used here.</p></div>
      <div className='sc-hero-status'><Status tone={demo?'warning':'good'}>{demo?'Local demo':'Authenticated cloud'}</Status><Status tone='warning'>Office worker offline</Status></div>
    </div>
    <div className='sc-layout'>
      <nav aria-label='Settings sections' className='sc-navigation'>
        <div className='sc-nav-label'>WORKSPACE SETTINGS</div>
        {tabs.map(({id,label,icon:Icon})=><button key={id} className={'sc-nav-link '+(tab===id?'selected':'')} onClick={()=>switchTab(id)} aria-current={tab===id?'page':undefined}><Icon size={16}/><span>{label}</span>{id==='dispatch'&&<span className='sc-nav-dot'/></button>)}
      </nav>
      <div className='sc-main'>
        {tab==='overview'&&<>
          <section className='sc-card'>
            <SectionHeader title='System overview' description='Actual available services and current operational data.'/>
            <div className='sc-metrics'>
              <div><Database size={19}/><span>Cloud workspace</span><strong>{demo?'Demo':'Connected'}</strong></div>
              <div><Server size={19}/><span>Office automation</span><strong>Not connected</strong></div>
              <div><ClipboardCheck size={19}/><span>Visible processes</span><strong>{records.length}</strong></div>
              <div><Workflow size={19}/><span>Queued jobs</span><strong>{waiting}</strong></div>
            </div>
          </section>
          <section className='sc-card'>
            <SectionHeader title='Configure your workspace' description='Open a category to review its controls and implementation status.'/>
            <div className='sc-overview-grid'>{tabs.filter(t=>t.id!=='overview').map(({id,label,icon:Icon})=><button key={id} className='sc-shortcut' onClick={()=>switchTab(id)}><Icon size={19}/><strong>{label}</strong><ArrowRight size={15}/></button>)}</div>
          </section>
          <Note>Worker controls, notification delivery, backup restoration and advanced automation require separate server-side implementation. They are not active from this design alone.</Note>
        </>}
        {tab==='dispatch'&&<section className='sc-card'>
          <SectionHeader title='Dispatch rules' description='Existing user-specific rules, stored in independent Supabase.' badge='LIVE SETTINGS'/>
          <div className='sc-fields'>
            <label className='ux-field'>E-Way Bill threshold (₹)<input type='number' min='0' max='100000000' step='1' value={draft.ebill_threshold} onChange={e=>change('ebill_threshold',Number(e.target.value))}/><small>Minimum invoice value requiring an E-Way Bill readiness check.</small></label>
            <label className='ux-field'>Re-track interval (days)<input type='number' min='1' max='90' step='1' value={draft.retrack_days} onChange={e=>change('retrack_days',Number(e.target.value))}/><small>Existing interval used for tracking review.</small></label>
            <label className='ux-field'>Reminder window (days)<input type='number' min='1' max='90' step='1' value={draft.reminder_days} onChange={e=>change('reminder_days',Number(e.target.value))}/><small>Existing reminder window for dispatch monitoring.</small></label>
          </div>
          {!valid&&<p className='sc-invalid' role='alert'>Enter a threshold from ₹0 to ₹100,000,000, and whole-day intervals from 1 to 90.</p>}
          <div className='sc-actions'><Button disabled={!dirty||saving} onClick={()=>{setDraft(settings);setDirty(false);}}>Discard changes</Button><Button variant='primary' disabled={demo||!authenticated||saving||!dirty||!valid} onClick={()=>void saveDispatch()}><Save size={16}/>{saving?'Saving…':'Save dispatch rules'}</Button></div>
          {demo&&<Note>Sign in to edit and save dispatch rules. Demo mode cannot write to Supabase.</Note>}
        </section>}
        {tab==='dispatch'&&<Planned title='Advanced dispatch configuration' items={['Overdue delivery escalation','Carrier-specific retry rules','E-Way Bill expiry warnings','Notification recipients and delivery schedule','Rule change history and approval gates']}/>}
        {tab==='worker'&&<>
          <section className='sc-card'><SectionHeader title='Office Python worker' description='Real-world DataDoc, Outlook and courier automation must run on the authorized office PC.' badge='AWAITING SETUP'/>
            <SettingRow title='Worker connection' description='No live authenticated heartbeat endpoint is configured.' right={<Status tone='warning'>Offline</Status>}/>
            <SettingRow title='Queued job requests' description='Requests remain queued until an approved worker claims them.' right={<strong>{waiting}</strong>}/>
            <SettingRow title='Failed job requests' description='Review failures before retrying any potentially non-idempotent action.' right={<strong>{failed}</strong>}/>
            <Note>Remote Start / Stop is intentionally unavailable until the Python worker is registered, secured and independently tested. No office PC command has been sent.</Note>
          </section>
          <Planned title='Worker connectivity roadmap' items={['Authenticated worker registration and heartbeat','Windows logon auto-start and safe local pause','Claim/lease a job with timeout recovery','Idempotency keys and manual verified retry','Operator-visible worker logs (secrets removed)']}/>
        </>}
        {tab==='automation'&&<>
          <section className='sc-card'><SectionHeader title='Automation job monitor' description='The cloud stores job requests; there is no connected job executor.' badge='MONITORING ONLY'/>
            <div className='sc-metrics'><div><Clock3 size={19}/><span>Queued</span><strong>{waiting}</strong></div><div><Activity size={19}/><span>Running</span><strong>{jobs.filter((j:any)=>j.status==='running').length}</strong></div><div><AlertTriangle size={19}/><span>Failed</span><strong>{failed}</strong></div></div>
            <div className='sc-actions'><Button onClick={()=>onGoto('Audit & Reports')}>Review job history <ArrowRight size={15}/></Button></div>
          </section>
          <Planned title='Automation controls' items={['DataDoc submission enable/disable','Outlook draft/send with human approval','Carrier tracking schedules','Per-action retry policies and dry-run mode','Action-specific roles and immutable audit log']}/>
        </>}
        {tab==='users'&&<>
          <section className='sc-card'><SectionHeader title='Access roles' description='Existing team authorization uses Admin, Operator and Viewer in Supabase.' badge='EXISTING ACCESS'/>
            <SettingRow title='Administrator' description='Manages invitations and approved sharing of personal processes.'/>
            <SettingRow title='Operator' description='Can work on authorized team processes and queue approved requests.'/>
            <SettingRow title='Viewer' description='Read-only access to authorized team processes and documents.'/>
          </section>
          {demo?<Note>Team administration requires cloud sign-in.</Note>:<TeamWorkspace userId={userId} records={records} selectedTeam={activeTeam} onTeamSelect={onTeamSelect} onChanged={onRefresh}/>}
          <Planned title='Role management expansion' items={['Per-feature permission matrix','Removal and role-change audit','Invite expiration and revocation','Admin safeguards against self-lockout']}/>
        </>}
        {tab==='pdf'&&<>
          <section className='sc-card'><SectionHeader title='PDF & OCR configuration' description='Current document reading uses PDF.js text extraction and Tesseract OCR fallback.' badge='EXISTING EXTRACTION'/>
            <SettingRow title='Pick Slip' description='Process No., Party Name, and SO No. are reviewed before saving.' right={<Status tone='good'>In use</Status>}/>
            <SettingRow title='Invoices and E-Invoices' description='PO No., PO Date and Payment Terms require source-sensitive review and conflict protection.' right={<Status tone='good'>In use</Status>}/>
            <SettingRow title='Document association' description='A Process No. must match the selected authorized record; OCR does not grant access.' right={<Status tone='good'>Verified</Status>}/>
          </section>
          <Planned title='OCR tuning and test bench' items={['Per-vendor field mapping templates','Run extraction against sample PDFs','Confidence thresholds and review queue','Side-by-side original and extracted values','Versioned mapping history']}/>
        </>}
        {tab==='camera'&&<>
          <section className='sc-card'><SectionHeader title='Done Pick List photo capture' description='Existing multi-photo albums and Process No. verification remain unchanged.' badge='EXISTING UPLOAD'/>
            <SettingRow title='Private photo storage' description='JPG, PNG and WebP; the current database limit is 5 MB per photo.' right={<Status tone='good'>Protected</Status>}/>
            <SettingRow title='Multi-photo capture' description='Photos are reviewed and grouped before an album is uploaded.' right={<Status tone='good'>Available</Status>}/>
            <div className='sc-actions'><Button variant='primary' onClick={()=>onGoto('Done Pick List')}>Open Done Pick List <ArrowRight size={16}/></Button></div>
          </section>
          <Planned title='Advanced camera preferences' items={['Configurable image compression','Camera resolution preset','Maximum images per album','Upload retry and progress controls','Optional photo metadata and capture timestamps']}/>
        </>}
        {tab==='alerts'&&<>
          <section className='sc-card'><SectionHeader title='Notifications & alerts' description='Pending task review is available; automatic outbound notifications are not configured.' badge='PARTIALLY AVAILABLE'/>
            <SettingRow title='Pending process checks' description='Existing completeness checks can be opened from the workspace.' right={<Status tone='good'>Available</Status>}/>
            <SettingRow title='Email, SMS or WhatsApp delivery' description='Requires server-side delivery integration and opt-in settings.' right={<Status>Not configured</Status>}/>
            <div className='sc-actions'><Button onClick={()=>onGoto('Pending Task Review')}>Open pending tasks <ArrowRight size={15}/></Button></div>
          </section>
          <Planned title='Alerts roadmap' items={['Worker offline and failed-job alerts','Dispatch escalation recipients','In-app notifications with read state','Notification digest and quiet hours','Duplicate and rate-limit protection']}/>
        </>}
        {tab==='backup'&&<>
          <section className='sc-card'><SectionHeader title='Export & recovery' description='Existing CSV export is not a full database or document backup.' badge='LIMITED EXPORT'/>
            <SettingRow title='Process register export' description='Export visible process reference fields as CSV; attached PDFs/images are not included.' right={<Status tone='good'>Available</Status>}/>
            <div className='sc-actions'><Button disabled={!records.length} onClick={onExport}><Download size={16}/> Export current register CSV</Button></div>
            <Note>Backup schedules, storage retention, and restoration cannot be validated from the browser. Do not rely on CSV alone as a backup or test restore against production.</Note>
          </section>
          {!demo&&<HistoricalImport records={records} teamId={activeTeam} onImported={onRefresh}/>}
          <Planned title='Backup and recovery roadmap' items={['Verified database backup schedule','Object-storage retention and recovery','Encrypted backup manifest and integrity check','Non-production restore rehearsal','Admin-only recovery approval and activity trail']}/>
        </>}
        {tab==='security'&&<>
          <section className='sc-card'><SectionHeader title='Security & audit' description='Cloud authentication, row-level policies and existing workflow events.' badge='PROTECTED CLOUD'/>
            <SettingRow title='Account access' description={demo?'Local demo has no cloud authorization.':'User is signed in with an authenticated cloud session.'} right={<Status tone={demo?'warning':'good'}>{demo?'Demo':'Authenticated'}</Status>}/>
            <SettingRow title='Independent storage' description='Private records and documents are protected by Supabase policies.' right={<Status tone={demo?'warning':'good'}>{demo?'Unavailable':'Configured'}</Status>}/>
            <SettingRow title='Recent workflow events' description='Process operations already produce cloud audit entries.' right={<strong>{events.length}</strong>}/>
            <div className='sc-actions'><Button onClick={()=>onGoto('Audit & Reports')}>Open audit & reports <ArrowRight size={15}/></Button></div>
          </section>
          <Planned title='Security expansion' items={['Security-setting changes audit','Session and MFA administration','Least-privilege authorization tests','Credential rotation runbook','Admin export/download log']}/>
        </>}
        {tab==='appearance'&&<>
          <section className='sc-card'><SectionHeader title='Display preferences' description='Layout density is saved in this browser and never modifies cloud data.' badge='LOCAL PREFERENCE'/>
            <div className='sc-choice-row' role='group' aria-label='Display density'>
              {(['comfortable','compact'] as const).map(v=><button key={v} className={'sc-choice '+(density===v?'active':'')} onClick={()=>setDensity(v)} aria-pressed={density===v}><LayoutDashboard size={17}/><strong>{v==='compact'?'Compact':'Comfortable'}</strong><small>{v==='compact'?'More rows visible':'More spacing'}</small>{density===v&&<CheckCircle2 size={16}/>}</button>)}
            </div>
            <p className='sc-muted'>Changes apply to supported page spacing and tables on this device. Cloud-wide themes are not enabled yet.</p>
          </section>
          <Planned title='Appearance roadmap' items={['Dark mode with accessible contrast','Per-user landing page selection','Column visibility preferences','User-synced display preferences']}/>
        </>}
      </div>
    </div>
  </div>;
}
