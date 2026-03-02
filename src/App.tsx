// src/App.tsx 전체 내용을 이걸로 교체하세요!
const { createClient } = (window as any).supabase;
import React, { useState, useEffect, useRef, useCallback } from 'react';

const SUPABASE_URL = 'https://tcmcrpszpbawgwolzuno.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ktL_xVzsDjv3wmbrO8j0Tg_DP2vYBHO';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);



// ── 줌 레벨별 레이아웃 계산 ──────────────────────────────
// 핵심 개념: TIMELINE_W = 1년 전체 너비 (모든 뷰 공통)
// year: colUnit=월, 화면에 12개월 꽉 참 (스크롤 없음)
// half: colUnit=월, 화면에 6개월 꽉 참 + 나머지 6개월 스크롤
// week: colUnit=주(52px), 52주 스크롤
// day:  colUnit=일(28px), 365일 스크롤
type ViewMode = 'year'|'half'|'week'|'day';

const WEEK_COL_W = 52;  // 1주 너비(px)
const DAY_COL_W  = 28;  // 1일 너비(px)

const calcLayout = (mode: ViewMode, screenW: number) => {
  const leftCol     = Math.max(260, Math.floor(screenW * 0.30));
  const assigneeCol = Math.max(56,  Math.floor(screenW * 0.06));
  const subCol      = Math.max(56,  Math.floor(screenW * 0.06));
  const availW      = screenW - leftCol - assigneeCol - subCol;

  let colW: number, totalTimelineW: number;
  if (mode === 'year') {
    colW = Math.floor(availW / 12);
    totalTimelineW = colW * 12;
  } else if (mode === 'half') {
    // 화면에 6개월 꽉 참, 12개월 전체 너비로 스크롤
    colW = Math.floor(availW / 6);
    totalTimelineW = colW * 12;
  } else if (mode === 'week') {
    colW = WEEK_COL_W;
    totalTimelineW = WEEK_COL_W * 52;
  } else { // day
    colW = DAY_COL_W;
    totalTimelineW = DAY_COL_W * 365;
  }
  return { leftCol, assigneeCol, subCol, colW, totalTimelineW };
};

// 정적 헤더 데이터 (렌더마다 재생성 방지)
const MONTH_LABELS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

// 주 헤더: 52개 항목 - 월별로 W1부터 리셋 (한 번만 생성)
const WEEK_HEADERS = (() => {
  const items: { label: string; isFirstOfMonth: boolean; month: number; weekInMonth: number }[] = [];
  const base = new Date('2026-01-01T00:00:00');
  let currentMonth = -1;
  let weekInMonth = 0;
  for (let w = 0; w < 52; w++) {
    const d = new Date(base); d.setDate(d.getDate() + w * 7);
    const month = d.getMonth() + 1;
    const isFirstOfMonth = month !== currentMonth;
    if (isFirstOfMonth) { currentMonth = month; weekInMonth = 1; }
    else { weekInMonth++; }
    items.push({ label: `W${weekInMonth}`, isFirstOfMonth, month, weekInMonth });
  }
  return items;
})();

// 일 헤더: 365개 - DOM 직접 생성 대신 배열로 (useMemo 등에서 사용)
const DAY_HEADERS = (() => {
  const items: { day: number; month: number; isFirst: boolean }[] = [];
  const base = new Date('2026-01-01T00:00:00');
  for (let i = 0; i < 365; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    items.push({ day: d.getDate(), month: d.getMonth()+1, isFirst: d.getDate()===1 });
  }
  return items;
})();

// const calcCols = (w: number, numCols: number = 12) => {
//   const leftCol     = Math.max(260, Math.floor(w * 0.30));
//   const assigneeCol = Math.max(56,  Math.floor(w * 0.06));
//   const subCol      = Math.max(56,  Math.floor(w * 0.06));
//   const timelineTotal = w - leftCol - assigneeCol - subCol;
//   const monthCol    = Math.floor(timelineTotal / numCols);
//   const timelineW   = monthCol * 12;
//   return { leftCol, assigneeCol, subCol, monthCol, timelineW };
// }; // 미사용 제거

const COLOR_MAP: Record<string, any> = {
  blue:   { bar:'#3b82f6', barLight:'#bfdbfe', text:'#1e40af', border:'#3b82f6', rowBg:'#f8faff' },
  green:  { bar:'#22c55e', barLight:'#bbf7d0', text:'#15803d', border:'#22c55e', rowBg:'#f6fef8' },
  purple: { bar:'#a855f7', barLight:'#e9d5ff', text:'#6b21a8', border:'#a855f7', rowBg:'#fdf8ff' },
  orange: { bar:'#f97316', barLight:'#fed7aa', text:'#c2410c', border:'#f97316', rowBg:'#fffaf5' },
  pink:   { bar:'#ec4899', barLight:'#fbcfe8', text:'#be185d', border:'#ec4899', rowBg:'#fef7fb' },
};

const CATEGORY_COLORS: Record<string, any> = {
  '영업': { bg:'#fef3c7', text:'#92400e', border:'#f59e0b' },
  '기획': { bg:'#fce7f3', text:'#9d174d', border:'#ec4899' },
  '운영': { bg:'#e0f2fe', text:'#075985', border:'#0ea5e9' },
  '개발': { bg:'#d1fae5', text:'#065f46', border:'#10b981' },
  '보안': { bg:'#fee2e2', text:'#991b1b', border:'#ef4444' },
};
const CATEGORIES = ['영업','기획','운영','개발','보안'];

const toDateStr = (d: Date) => d.toISOString().split('T')[0];
const parseDate = (s: string) => new Date(s + 'T00:00:00');
const todayStr = () => toDateStr(new Date());
const weekLaterStr = () => { const d = new Date(); d.setDate(d.getDate() + 7); return toDateStr(d); };

// ── 로그인 화면 ────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (user: any) => void }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async () => {
    if (!email || !password) { setError('이메일과 비밀번호를 입력해주세요.'); return; }
    setLoading(true); setError('');
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError('이메일 또는 비밀번호가 올바르지 않습니다.'); }
      else if (data.user) { onLogin(data.user); }
    } catch { setError('로그인 중 오류가 발생했습니다.'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 60%,#16213e 100%)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Pretendard',-apple-system,BlinkMacSystemFont,sans-serif"}}>
      <style>{`@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css'); @keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box;}`}</style>
      <div style={{width:'100%',maxWidth:400,padding:'0 24px'}}>
        {/* 로고 */}
        <div style={{textAlign:'center',marginBottom:40}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,marginBottom:14}}>
            <div style={{width:52,height:52,borderRadius:14,background:'linear-gradient(135deg,#6366f1,#8b5cf6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,boxShadow:'0 4px 18px rgba(99,102,241,0.45)'}}>📱</div>
            <div style={{width:2,height:40,background:'rgba(255,255,255,0.12)',borderRadius:2}} />
            <div style={{width:52,height:52,borderRadius:14,background:'linear-gradient(135deg,#0ea5e9,#6366f1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,boxShadow:'0 4px 18px rgba(14,165,233,0.4)'}}>🚌</div>
          </div>
          <h1 style={{fontSize:36,fontWeight:'bold',color:'#f1f5f9',margin:'0 0 10px',letterSpacing:'-1px'}}>간트차트</h1>
          <p style={{fontSize:16,color:'rgba(148,163,184,0.8)',margin:0,fontWeight:500}}>팀원만 접근 가능한 프로젝트 관리 도구</p>
        </div>
        {/* 로그인 카드 */}
        <div style={{background:'rgba(255,255,255,0.05)',borderRadius:16,padding:32,border:'1px solid rgba(255,255,255,0.1)',backdropFilter:'blur(10px)'}}>
          <div style={{marginBottom:18}}>
            <label style={{display:'block',fontSize:13,color:'rgba(148,163,184,0.8)',marginBottom:7,fontWeight:500}}>이메일</label>
            <input type="email" value={email} onChange={e=>{setEmail(e.target.value);setError('');}}
              onKeyDown={e=>e.key==='Enter'&&handleLogin()}
              placeholder="이메일 입력"
              style={{width:'100%',padding:'11px 14px',background:'rgba(255,255,255,0.07)',border:`1px solid ${error?'rgba(239,68,68,0.5)':'rgba(255,255,255,0.12)'}`,borderRadius:10,fontSize:14,color:'#f1f5f9',outline:'none'}} />
          </div>
          <div style={{marginBottom:24}}>
            <label style={{display:'block',fontSize:13,color:'rgba(148,163,184,0.8)',marginBottom:7,fontWeight:500}}>비밀번호</label>
            <input type="password" value={password} onChange={e=>{setPassword(e.target.value);setError('');}}
              onKeyDown={e=>e.key==='Enter'&&handleLogin()}
              placeholder="비밀번호 입력"
              style={{width:'100%',padding:'11px 14px',background:'rgba(255,255,255,0.07)',border:`1px solid ${error?'rgba(239,68,68,0.5)':'rgba(255,255,255,0.12)'}`,borderRadius:10,fontSize:14,color:'#f1f5f9',outline:'none'}} />
          </div>
          {error && (
            <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',marginBottom:18,fontSize:13,color:'#fca5a5'}}>
              ⚠️ {error}
            </div>
          )}
          <button onClick={handleLogin} disabled={loading}
            style={{width:'100%',padding:'12px',background:loading?'rgba(99,102,241,0.5)':'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:600,cursor:loading?'not-allowed':'pointer',boxShadow:'0 2px 12px rgba(99,102,241,0.4)',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
            {loading ? (
              <><div style={{width:16,height:16,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />로그인 중...</>
            ) : '로그인'}
          </button>
        </div>
        <p style={{textAlign:'center',fontSize:12,color:'rgba(148,163,184,0.35)',marginTop:24}}>© 2026 S&I Corp. 내부 전용</p>
      </div>
    </div>
  );
}
// ────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [appId, setAppId] = useState<1|2>(() => {
    const saved = localStorage.getItem('gantt_last_app');
    return (saved === '1' ? 1 : 2) as 1|2; // 2: 샌디앱, 1: 샌디버스
  });
  const [authLoading, setAuthLoading] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setUser(session?.user ?? null);
        setIsResetMode(true);
      } else {
        setUser(session?.user ?? null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (authLoading) return (
    <div style={{minHeight:'100vh',background:'#0f0f1a',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{width:32,height:32,border:'4px solid rgba(99,102,241,0.3)',borderTopColor:'#6366f1',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );

  if (isResetMode && user) return (
    <ResetPasswordScreen user={user} onDone={async () => {
      setIsResetMode(false);
    }} />
  );

  if (!user) return <LoginScreen onLogin={setUser} />;

  return <GanttChart user={user} appId={appId} onAppChange={(id) => { setAppId(id); localStorage.setItem('gantt_last_app', String(id)); }} onLogout={async () => { await supabase.auth.signOut(); setUser(null); }} />;
}

// ── 비밀번호 재설정 화면 ──────────
function ResetPasswordScreen({ user, onDone }: { user: any; onDone: () => void }) {
  const [newPw, setNewPw]         = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const [loading, setLoading]     = useState(false);

  const handleReset = async () => {
    setError('');
    if (!newPw || !confirmPw) { setError('모든 항목을 입력해주세요.'); return; }
    if (newPw.length < 6) { setError('비밀번호는 6자 이상이어야 합니다.'); return; }
    if (newPw !== confirmPw) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPw });
      if (err) { setError('비밀번호 변경에 실패했습니다.'); }
      else { setSuccess(true); setTimeout(() => onDone(), 2000); }
    } catch { setError('오류가 발생했습니다.'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 60%,#16213e 100%)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Pretendard',-apple-system,BlinkMacSystemFont,sans-serif"}}>
      <style>{`@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css'); @keyframes spin{to{transform:rotate(360deg)}} *{box-sizing:border-box;}`}</style>
      <div style={{width:'100%',maxWidth:400,padding:'0 24px'}}>
        <div style={{textAlign:'center',marginBottom:36}}>
          <div style={{width:56,height:56,borderRadius:16,background:'linear-gradient(135deg,#6366f1,#a855f7)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,margin:'0 auto 16px',boxShadow:'0 4px 20px rgba(99,102,241,0.4)'}}>🔑</div>
          <h1 style={{fontSize:20,fontWeight:'bold',color:'#f1f5f9',margin:'0 0 6px'}}>새 비밀번호 설정</h1>
          <p style={{fontSize:13,color:'rgba(148,163,184,0.6)',margin:0}}>{user.email}</p>
        </div>
        <div style={{background:'rgba(255,255,255,0.05)',borderRadius:16,padding:28,border:'1px solid rgba(255,255,255,0.1)'}}>
          {success ? (
            <div style={{textAlign:'center',padding:'20px 0'}}>
              <div style={{fontSize:40,marginBottom:12}}>✅</div>
              <p style={{color:'#4ade80',fontSize:15,fontWeight:600,margin:0}}>비밀번호가 변경되었습니다!</p>
              <p style={{color:'rgba(148,163,184,0.6)',fontSize:13,marginTop:8}}>잠시 후 로그인 화면으로 이동합니다...</p>
            </div>
          ) : (
            <>
              <div style={{marginBottom:16}}>
                <label style={{display:'block',fontSize:13,color:'rgba(148,163,184,0.8)',marginBottom:7,fontWeight:500}}>새 비밀번호 <span style={{fontSize:11,opacity:0.6}}>(6자 이상)</span></label>
                <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="새 비밀번호 입력"
                  style={{width:'100%',padding:'11px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,fontSize:14,color:'#f1f5f9',outline:'none'}} />
              </div>
              <div style={{marginBottom:20}}>
                <label style={{display:'block',fontSize:13,color:'rgba(148,163,184,0.8)',marginBottom:7,fontWeight:500}}>새 비밀번호 확인</label>
                <input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&handleReset()} placeholder="새 비밀번호 재입력"
                  style={{width:'100%',padding:'11px 14px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,fontSize:14,color:'#f1f5f9',outline:'none'}} />
              </div>
              {error && <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#fca5a5'}}>⚠️ {error}</div>}
              <button onClick={handleReset} disabled={loading}
                style={{width:'100%',padding:'12px',background:loading?'rgba(99,102,241,0.5)':'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'white',border:'none',borderRadius:10,fontSize:15,fontWeight:600,cursor:loading?'not-allowed':'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                {loading ? <><div style={{width:16,height:16,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'white',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />변경 중...</> : '비밀번호 변경'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
// ────────────────────────────────────────────────────

function GanttChart({ user, appId, onAppChange, onLogout }: { user: any; appId: 1|2; onAppChange: (id: 1|2) => void; onLogout: () => void }) {
  const APP_CONFIG = {
    1: { name: '샌디버스 간트차트', channel: 'gantt-bus-sync', csvPrefix: '샌디버스' },
    2: { name: '샌디앱 간트차트',   channel: 'gantt-app-sync', csvPrefix: '샌디앱'   },
  };
  const currentApp = APP_CONFIG[appId];

  const [viewMode, setViewMode] = useState<ViewMode>('year');

  // ── 레이아웃 (useMemo로 viewMode/화면폭 변경시만 재계산) ──
  const [screenW, setScreenW] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setScreenW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const layout   = React.useMemo(() => calcLayout(viewMode, screenW), [viewMode, screenW]);
  const LEFT_COL     = layout.leftCol;
  const ASSIGNEE_COL = layout.assigneeCol;
  const SUB_COL      = layout.subCol;
  const MONTH_COL    = layout.colW;
  const TIMELINE_W   = layout.totalTimelineW;

  // 세로 구분선: 헤더 셀과 동일한 borderRight 방식 — 픽셀 퍼펙트 일치
  // 모든 뷰에서 동일한 색상(#e8ecf8)으로 통일, 월 경계 강조 없음
  const gridColCount = viewMode === 'day' ? 365 : viewMode === 'week' ? 52 : 12;
  const GridLines = (
    <div style={{position:'absolute',inset:0,display:'flex',pointerEvents:'none',zIndex:0}}>
      {Array.from({length: gridColCount}, (_,i) => (
        <div key={i} style={{width:MONTH_COL,minWidth:MONTH_COL,flexShrink:0,height:'100%',borderRight:i<gridColCount-1?'1px solid #e8ecf8':'none'}} />
      ))}
    </div>
  );

  // 항상 1년 전체 기준
  const V_START      = new Date('2026-01-01T00:00:00');
  const V_END        = new Date('2026-12-31T00:00:00');
  const V_TOTAL_DAYS = 365;
  // const V_MONTHS = MONTH_LABELS; // 미사용 제거

  // const [cols, setCols] = useState(() => calcCols(window.innerWidth, 12)); // 미사용 제거

  const [projects, setProjects]               = useState<any[]>([]);
  const [searchQuery, setSearchQuery]         = useState('');
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [activeGroup, setActiveGroup]         = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading]                 = useState(true);
  const [saving, setSaving]                   = useState(false);
  const [editingTask, setEditingTask]         = useState<any>(null);
  const [editingProject, setEditingProject]   = useState<any>(null);
  const [editingGroupName, setEditingGroupName] = useState<string|null>(null);
  const [editingGroupValue, setEditingGroupValue] = useState('');
  const [dragging, setDragging]               = useState<any>(null);
  const [tooltip, setTooltip]                 = useState<any>(null);
  const [tooltipPos, setTooltipPos]           = useState({ x:0, y:0 });

  const [showHistory, setShowHistory]         = useState(false);
  const [history, setHistory]                 = useState<any[]>([]);
  const [historyLoading, setHistoryLoading]   = useState(false);
  const [restoring, setRestoring]             = useState(false);
  const [showChangePw, setShowChangePw]       = useState(false);
  const [rowDrag, setRowDrag]                 = useState<any>(null);
  const [rowDragOver, setRowDragOver]         = useState<any>(null);
  const [groupOrder, setGroupOrder]           = useState<string[]>([]);
  // ── Realtime 수신 알림 표시용 ──
  const [realtimeToast, setRealtimeToast]     = useState(false);
  const dragRef        = useRef<any>(null);
  const rowDragRef     = useRef<any>(null);
  const historyTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef      = useRef<HTMLDivElement>(null);
  const draggingRef    = useRef<any>(null);
  const isSavingRef    = useRef<boolean>(false); // 내가 저장 중일 때 Realtime 토스트 무시
  const toastTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HISTORY_DEBOUNCE_MS = 5 * 60 * 1000;

  // dragging state 변경 시 ref도 동기화
  useEffect(() => { draggingRef.current = dragging; }, [dragging]);

  const getPos = useCallback((s: string, e: string) => {
    if (!s || !e) return null;
    const sd = parseDate(s), ed = parseDate(e);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return null;
    const startDays = (sd.getTime() - V_START.getTime()) / 86400000;
    const endDays   = (ed.getTime() - V_START.getTime()) / 86400000;
    const left  = Math.max(0, startDays / V_TOTAL_DAYS * TIMELINE_W);
    const right = Math.min(TIMELINE_W, endDays / V_TOTAL_DAYS * TIMELINE_W);
    return { left, width: Math.max(6, right - left) };
  }, [TIMELINE_W]);

  const assignLanes = (tasks: any[]) => {
    const BAR_GAP_PX = 4;
    const laneEnds: number[] = [];
    const sorted = [...tasks]
      .map((task, origIdx) => ({ task, origIdx }))
      .sort((a, b) => (a.task.startDate || '').localeCompare(b.task.startDate || ''));
    const result: { task: any; lane: number; pos: any }[] = new Array(tasks.length);
    sorted.forEach(({ task, origIdx }) => {
      const pos = getPos(task.startDate, task.endDate);
      if (!pos) { result[origIdx] = { task, lane: 0, pos: null }; return; }
      const laneIdx = laneEnds.findIndex(end => end + BAR_GAP_PX <= pos.left);
      const lane = laneIdx === -1 ? laneEnds.length : laneIdx;
      laneEnds[lane] = pos.left + pos.width;
      result[origIdx] = { task, lane, pos };
    });
    return result;
  };

  // ── 최초 로드 + Realtime 구독 (appId 변경 시 재실행) ──────────────────────────
  useEffect(() => {
    setProjects([]);
    load();

    const channel = supabase
      .channel(currentApp.channel)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'gantt_projects', filter: `id=eq.${appId}` },
        (payload: any) => {
          // 내가 저장 중이거나 드래그 중이면 무시
          if (isSavingRef.current || draggingRef.current) return;
          setProjects(payload.new.data || []);
          // 토스트 알림 표시
          if (toastTimer.current) clearTimeout(toastTimer.current);
          setRealtimeToast(true);
          toastTimer.current = setTimeout(() => setRealtimeToast(false), 2500);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [appId]);
  // ──────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('gantt_projects').select('data').eq('id', appId).single();
      if (!error && data) setProjects(data.data || []);
    } catch {}
    finally { setLoading(false); }
  };

  const saveHistorySnapshot = async (p: any[], memo?: string) => {
    try {
      await supabase.from('gantt_history').insert({ data: p, memo: memo || '' });
    } catch {}
  };

  const save = async (p: any[], memo?: string) => {
    setProjects(p);
    setSaving(true);
    isSavingRef.current = true;
    try {
      await supabase.from('gantt_projects').upsert({ id: appId, data: p });
    } catch {}
    finally {
      setSaving(false);
      setTimeout(() => { isSavingRef.current = false; }, 1000); // 1초 여유
    }

    if (historyTimer.current) clearTimeout(historyTimer.current);
    historyTimer.current = setTimeout(() => {
      saveHistorySnapshot(p, memo);
    }, HISTORY_DEBOUNCE_MS);
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setShowHistory(true);
    try {
      const { data } = await supabase
        .from('gantt_history')
        .select('id, saved_at, memo')
        .order('saved_at', { ascending: false })
        .limit(50);
      setHistory(data || []);
    } catch {}
    finally { setHistoryLoading(false); }
  };

  const restoreHistory = async (id: number) => {
    if (!confirm('이 시점으로 복원할까요?\n현재 데이터는 덮어쓰여집니다.')) return;
    setRestoring(true);
    try {
      const { data } = await supabase.from('gantt_history').select('data').eq('id', id).single();
      if (data) {
        setProjects(data.data);
        setSaving(true);
        try { await supabase.from('gantt_projects').upsert({ id: appId, data: data.data }); } catch {}
        finally { setSaving(false); }
        await saveHistorySnapshot(data.data, '복원됨');
        setShowHistory(false);
        alert('복원 완료!');
      }
    } catch {
      alert('복원 중 오류가 발생했습니다.');
    }
    finally { setRestoring(false); }
  };

  const addProject = () => save([...projects, {
    id:Date.now(), name:'새 프로젝트', owner:'', subOwner:'', description:'',
    color:'blue', expanded:true, tasks:[], category:'기획',
    group: activeGroup || '미분류',
    startDate:todayStr(), endDate:weekLaterStr(), progress:0
  }]);

  const addTask = (pid: number) => save(projects.map(p => p.id !== pid ? p : {
    ...p, tasks:[...p.tasks, {
      id:Date.now(), name:'새 Task', assignee:'', subAssignee:'',
      startDate:todayStr(), endDate:weekLaterStr(),
      progress:0, dependencies:[], description:'', category: p.category||''
    }]
  }));

  const toggleProject  = (pid: number) => setProjects(projects.map(p => p.id===pid ? {...p, expanded:!p.expanded} : p));
  const updateTask     = (pid: number, tid: number, upd: any) => save(projects.map(p => p.id!==pid ? p : {...p, tasks:p.tasks.map((t:any)=>t.id!==tid?t:{...t,...upd})}));
  const deleteTask     = (pid: number, tid: number) => save(projects.map(p => p.id!==pid ? p : {...p, tasks:p.tasks.filter((t:any)=>t.id!==tid)}));
  const deleteProject  = (pid: number) => save(projects.filter(p => p.id!==pid));
  const updateProject  = (pid: number, upd: any) => save(projects.map(p => p.id!==pid ? p : {...p,...upd}));

  const toggleGroup = (g: string) => setCollapsedGroups(prev => {
    const next = new Set(prev); next.has(g) ? next.delete(g) : next.add(g); return next;
  });

  const renameGroup = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) return;
    save(projects.map(p => p.group === oldName ? {...p, group: newName.trim()} : p));
  };

  const getProjectMeta = (proj: any) => {
    const tasks = proj.tasks.filter((t:any) => t.startDate && t.endDate);
    if (!tasks.length) {
      if (proj.startDate && proj.endDate) return { pos:getPos(proj.startDate, proj.endDate), progress:proj.progress||0 };
      return { pos:null, progress:0 };
    }
    const starts = tasks.map((t:any) => +parseDate(t.startDate));
    const ends   = tasks.map((t:any) => +parseDate(t.endDate));
    let totalW=0, totalP=0;
    tasks.forEach((t:any) => {
      const dur = Math.max(1, (parseDate(t.endDate).getTime()-parseDate(t.startDate).getTime())/86400000);
      totalW+=dur; totalP+=(t.progress||0)*dur;
    });
    const visStart = toDateStr(new Date(Math.max(Math.min(...starts), +V_START)));
    const visEnd   = toDateStr(new Date(Math.min(Math.max(...ends),   +V_END)));
    return { pos:getPos(visStart, visEnd), progress:totalW>0?Math.round(totalP/totalW):0 };
  };

  const handleMouseDown = (e: React.MouseEvent, pid: number, tid: any, type: string) => {
    e.preventDefault(); e.stopPropagation();
    if (tid==='__proj__') {
      const proj = projects.find(p=>p.id===pid); if (!proj) return;
      dragRef.current = { pid, tid:'__proj__', type, startX:e.clientX, startDate:proj.startDate, endDate:proj.endDate };
    } else {
      const task = projects.find(p=>p.id===pid)?.tasks.find((t:any)=>t.id===tid); if (!task) return;
      dragRef.current = { pid, tid, type, startX:e.clientX, startDate:task.startDate, endDate:task.endDate };
    }
    isSavingRef.current = true; // 드래그 시작 시 내 액션으로 표시
    setDragging({ pid, tid, type });
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      e.preventDefault();
      const deltaDays = Math.round(((e.clientX - d.startX) / TIMELINE_W) * V_TOTAL_DAYS);
      const s0=parseDate(d.startDate), e0=parseDate(d.endDate);
      let ns=new Date(s0), ne=new Date(e0);
      if (d.type==='move') {
        ns=new Date(+s0+deltaDays*86400000); ne=new Date(+e0+deltaDays*86400000);
        if (ns<V_START){const diff=V_START.getTime()-ns.getTime();ns=new Date(V_START);ne=new Date(+ne+diff);}
        if (ne>V_END)  {const diff=ne.getTime()-V_END.getTime();ne=new Date(V_END);ns=new Date(+ns-diff);}
      } else if (d.type==='start') {
        ns=new Date(Math.max(+V_START,Math.min(+s0+deltaDays*86400000,+e0-86400000)));
      } else {
        ne=new Date(Math.min(+V_END,Math.max(+e0+deltaDays*86400000,+s0+86400000)));
      }
      const nsStr = toDateStr(ns), neStr = toDateStr(ne);
      // 드래그 중에는 로컬 state만 업데이트 (DB 저장 없음)
      if (d.tid==='__proj__') {
        setProjects(prev => prev.map(p => p.id!==d.pid ? p : {...p, startDate:nsStr, endDate:neStr}));
      } else {
        setProjects(prev => prev.map(p => p.id!==d.pid ? p : {...p, tasks:p.tasks.map((t:any)=>t.id!==d.tid?t:{...t,startDate:nsStr,endDate:neStr})}));
      }
      setTooltip((t:any)=>t?{...t,startDate:nsStr,endDate:neStr}:t);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current=null;
      setDragging(null);
      document.body.style.cursor='';
      document.body.style.userSelect='';
      // 마우스 놓을 때 현재 state를 DB에 저장
      if (d) {
        setProjects(prev => {
          const latest = prev;
          setSaving(true);
          supabase.from('gantt_projects').upsert({ id: appId, data: latest })
            .then(() => {
              setSaving(false);
              setTimeout(() => { isSavingRef.current = false; }, 1000);
              if (historyTimer.current) clearTimeout(historyTimer.current);
              historyTimer.current = setTimeout(() => { saveHistorySnapshot(latest); }, HISTORY_DEBOUNCE_MS);
            })
            .catch(() => { setSaving(false); setTimeout(() => { isSavingRef.current = false; }, 1000); });
          return latest;
        });
      } else {
        setTimeout(() => { isSavingRef.current = false; }, 1500);
      }
    };
    document.body.style.userSelect='none';
    document.body.style.cursor=dragging.type==='move'?'grabbing':'ew-resize';
    window.addEventListener('mousemove', onMove, {passive:false});
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragging, TIMELINE_W]);

  const rawGroups = Array.from(new Set(projects.map(p => p.group || '미분류')));
  const allGroups = [
    ...groupOrder.filter(g => rawGroups.includes(g)),
    ...rawGroups.filter(g => !groupOrder.includes(g))
  ];

  const filtered = projects
    .filter(p => activeCategories.length===0 || activeCategories.includes(p.category))
    .filter(p => activeGroup==='' || (p.group||'미분류')===activeGroup)
    .filter(p =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.owner?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tasks.some((t:any)=>t.name.toLowerCase().includes(searchQuery.toLowerCase())||t.assignee?.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const groupedFiltered = allGroups
    .filter(g => activeGroup==='' || g===activeGroup)
    .map(g => ({ name:g, items: filtered.filter(p=>(p.group||'미분류')===g) }))
    .filter(g => g.items.length > 0);

  const handleRowDragStart = (e: React.DragEvent, info: any) => {
    rowDragRef.current = info;
    setRowDrag(info);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(new Image(), 0, 0);
  };
  const handleRowDragOver = (e: React.DragEvent, info: any) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setRowDragOver(info);
  };
  const handleRowDrop = (e: React.DragEvent, target: any) => {
    e.preventDefault();
    const src = rowDragRef.current;
    if (!src || !target) { setRowDrag(null); setRowDragOver(null); return; }

    if (src.type === 'group' && target.type === 'group' && src.name !== target.name) {
      const cur = allGroups.filter(g => g !== src.name);
      const ti = cur.indexOf(target.name);
      cur.splice(ti, 0, src.name);
      setGroupOrder(cur);

    } else if (src.type === 'project' && target.type === 'project' && src.id !== target.id) {
      const srcProj = projects.find((p:any) => p.id === src.id);
      if (!srcProj) return;
      const tgtGroup = target.group;
      const updatedSrcProj = { ...srcProj, group: tgtGroup };
      const withoutSrc = projects.filter((p:any) => p.id !== src.id);
      const tgtIdx = withoutSrc.findIndex((p:any) => p.id === target.id);
      const newProjects = [...withoutSrc];
      newProjects.splice(tgtIdx, 0, updatedSrcProj);
      save(newProjects);

    } else if (src.type === 'task' && target.type === 'task' && src.tid !== target.tid) {
      const srcProj = projects.find((p:any) => p.id === src.pid);
      if (!srcProj) return;
      const srcTask = srcProj.tasks.find((t:any) => t.id === src.tid);
      if (!srcTask) return;

      if (src.pid === target.pid) {
        const newProjects = projects.map((p:any) => {
          if (p.id !== src.pid) return p;
          const tasks = [...p.tasks];
          const si = tasks.findIndex((t:any) => t.id === src.tid);
          const ti = tasks.findIndex((t:any) => t.id === target.tid);
          tasks.splice(si, 1);
          tasks.splice(ti, 0, srcProj.tasks[si]);
          return { ...p, tasks };
        });
        save(newProjects);
      } else {
        const newProjects = projects.map((p:any) => {
          if (p.id === src.pid) return { ...p, tasks: p.tasks.filter((t:any) => t.id !== src.tid) };
          if (p.id === target.pid) {
            const tasks = [...p.tasks];
            const ti = tasks.findIndex((t:any) => t.id === target.tid);
            tasks.splice(ti, 0, srcTask);
            return { ...p, tasks };
          }
          return p;
        });
        save(newProjects);
      }

    } else if (src.type === 'task' && target.type === 'project') {
      const srcProj = projects.find((p:any) => p.id === src.pid);
      if (!srcProj || src.pid === target.id) return;
      const srcTask = srcProj.tasks.find((t:any) => t.id === src.tid);
      if (!srcTask) return;
      const newProjects = projects.map((p:any) => {
        if (p.id === src.pid) return { ...p, tasks: p.tasks.filter((t:any) => t.id !== src.tid) };
        if (p.id === target.id) return { ...p, tasks: [...p.tasks, srcTask] };
        return p;
      });
      save(newProjects);
    }
    setRowDrag(null); setRowDragOver(null);
  };
  const handleRowDragEnd = () => { setRowDrag(null); setRowDragOver(null); };

  const exportCSV = () => {
    const headers = ['그룹','카테고리','프로젝트','오너(정)','부오너(부)','프로젝트 시작일','프로젝트 종료일','프로젝트 진행률','프로젝트 설명','Task','Task 설명','담당자(정)','부담당자(부)','Task 시작일','Task 종료일','Task 진행률'];
    const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows: string[][] = [];
    projects
      .filter(p => activeCategories.length===0 || activeCategories.includes(p.category))
      .forEach(proj => {
        const { progress: projProg } = getProjectMeta(proj);
        const base = [proj.group||'미분류', proj.category||'', proj.name, proj.owner||'', proj.subOwner||'', proj.startDate||'', proj.endDate||'', `${projProg}%`, proj.description||''];
        if (proj.tasks.length === 0) {
          rows.push([...base, '', '', '', '', '', '', '']);
        } else {
          proj.tasks.forEach((t: any) => {
            rows.push([...base, t.name, t.description||'', t.assignee||'', t.subAssignee||'', t.startDate||'', t.endDate||'', `${t.progress||0}%`]);
          });
        }
      });
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${currentApp.csvPrefix}_간트차트_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const today = new Date();
  const todayLeft = today>=V_START && today<=V_END
    ? Math.round((today.getTime()-V_START.getTime())/86400000/V_TOTAL_DAYS*TIMELINE_W) : null;

  const modalW = Math.min(500, Math.max(320, window.innerWidth * 0.9));
  const inp = (extra={}) => ({width:'100%',border:'1px solid #d1d5db',borderRadius:8,padding:'8px 12px',fontSize:14,boxSizing:'border-box' as const,...extra});

  const ProjectEditModal = ({ proj, onClose }: any) => {
    const [fd, setFd] = useState({...proj});

    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,padding:16}}>
        <div style={{background:'white',borderRadius:12,padding:24,width:modalW,boxShadow:'0 20px 60px rgba(0,0,0,0.3)',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <h3 style={{fontSize:18,fontWeight:'bold',margin:0}}>프로젝트 편집</h3>
            <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:'#9ca3af'}}>✕</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>프로젝트 이름</label>
              <input value={fd.name} onChange={e=>setFd({...fd,name:e.target.value})} style={inp()} /></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>오너 (정)</label>
                <input value={fd.owner||''} onChange={e=>setFd({...fd,owner:e.target.value})} style={inp()} /></div>
              <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>오너 (부)</label>
                <input value={fd.subOwner||''} onChange={e=>setFd({...fd,subOwner:e.target.value})} style={inp()} /></div>
            </div>
            <div>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:8}}>그룹 <span style={{fontSize:12,color:'#9ca3af',fontWeight:400}}>(서비스/제품 단위)</span></label>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                {allGroups.filter(g=>g!=='미분류').map(g=>(
                  <button key={g} type="button" onClick={()=>setFd({...fd,group:g})}
                    style={{padding:'6px 14px',borderRadius:20,fontSize:13,cursor:'pointer',fontWeight:fd.group===g?600:400,border:fd.group===g?'2px solid #6366f1':'2px solid #e5e7eb',background:fd.group===g?'#eef2ff':'white',color:fd.group===g?'#4338ca':'#6b7280',transition:'all 0.1s'}}>
                    {g}
                  </button>
                ))}
                <button type="button" onClick={()=>setFd({...fd,group:''})}
                  style={{padding:'6px 14px',borderRadius:20,fontSize:13,cursor:'pointer',fontWeight:fd.group===''||fd.group==='미분류'?600:400,border:fd.group===''||fd.group==='미분류'?'2px solid #9ca3af':'2px solid #e5e7eb',background:fd.group===''||fd.group==='미분류'?'#f3f4f6':'white',color:'#6b7280'}}>
                  미분류
                </button>
              </div>
              <input value={(!allGroups.filter(g=>g!=='미분류').includes(fd.group) && fd.group && fd.group!=='미분류') ? fd.group : ''}
                onChange={e=>setFd({...fd,group:e.target.value})}
                placeholder="+ 새 그룹 직접 입력"
                style={{...inp(),fontSize:13,color:'#374151',background: (!allGroups.filter(g=>g!=='미분류').includes(fd.group) && fd.group && fd.group!=='미분류')?'#f0f4ff':'white',borderColor:(!allGroups.filter(g=>g!=='미분류').includes(fd.group) && fd.group && fd.group!=='미분류')?'#6366f1':'#d1d5db'}} />
            </div>
            <div>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:8}}>카테고리</label>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {CATEGORIES.map(cat=>{
                  const cc=CATEGORY_COLORS[cat];
                  return <button key={cat} onClick={()=>setFd({...fd,category:cat})}
                    style={{padding:'6px 16px',borderRadius:20,border:`2px solid ${fd.category===cat?cc.border:'#e5e7eb'}`,background:fd.category===cat?cc.bg:'white',color:fd.category===cat?cc.text:'#6b7280',cursor:'pointer',fontSize:13,fontWeight:fd.category===cat?600:400}}>{cat}</button>;
                })}
              </div>
            </div>
            <div>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>프로젝트 기간 <span style={{fontSize:12,color:'#9ca3af',fontWeight:400}}>(Task 없을 때)</span></label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={{display:'block',fontSize:12,color:'#6b7280',marginBottom:4}}>시작일</label>
                  <input type="date" value={fd.startDate||''} onChange={e=>setFd({...fd,startDate:e.target.value})} style={inp()} /></div>
                <div><label style={{display:'block',fontSize:12,color:'#6b7280',marginBottom:4}}>종료일</label>
                  <input type="date" value={fd.endDate||''} onChange={e=>setFd({...fd,endDate:e.target.value})} style={inp()} /></div>
              </div>
            </div>
            <div>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>
                진행률 <span style={{fontSize:12,color:'#9ca3af',fontWeight:400}}>(Task 없을 때)</span>
                <span style={{color:'#3b82f6',fontWeight:'bold',marginLeft:8}}>{fd.progress||0}%</span>
              </label>
              <input type="range" min="0" max="100" value={fd.progress||0} onChange={e=>setFd({...fd,progress:Number(e.target.value)})} style={{width:'100%'}} />
            </div>
            <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>설명</label>
              <textarea value={fd.description||''} onChange={e=>setFd({...fd,description:e.target.value})} style={{...inp(),height:80,resize:'vertical'} as any} /></div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:24}}>
            <button onClick={onClose} style={{padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:8,background:'white',cursor:'pointer',fontSize:14}}>취소</button>
            <button onClick={()=>{updateProject(proj.id,fd);onClose();}} style={{padding:'8px 16px',border:'none',borderRadius:8,background:'#3b82f6',color:'white',cursor:'pointer',fontSize:14,fontWeight:500}}>저장</button>
          </div>
        </div>
      </div>
    );
  };

  const TaskEditModal = ({ task, pid, onClose }: any) => {
    const [fd, setFd] = useState({...task});
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,padding:16}}>
        <div style={{background:'white',borderRadius:12,padding:24,width:modalW,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e=>e.stopPropagation()}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <h3 style={{fontSize:18,fontWeight:'bold',margin:0}}>Task 편집</h3>
            <button onClick={onClose} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:'#9ca3af'}}>✕</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:16}}>
            <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>Task 이름</label>
              <input value={fd.name} onChange={e=>setFd({...fd,name:e.target.value})} style={inp()} /></div>
            <div>
              <label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:8}}>카테고리</label>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <button onClick={()=>setFd({...fd,category:''})}
                  style={{padding:'6px 14px',borderRadius:20,border:`2px solid ${!fd.category?'#6b7280':'#e5e7eb'}`,background:!fd.category?'#f3f4f6':'white',color:!fd.category?'#374151':'#9ca3af',cursor:'pointer',fontSize:13,fontWeight:!fd.category?600:400}}>없음</button>
                {CATEGORIES.map(cat=>{
                  const cc=CATEGORY_COLORS[cat];
                  return <button key={cat} onClick={()=>setFd({...fd,category:cat})}
                    style={{padding:'6px 14px',borderRadius:20,border:`2px solid ${fd.category===cat?cc.border:'#e5e7eb'}`,background:fd.category===cat?cc.bg:'white',color:fd.category===cat?cc.text:'#6b7280',cursor:'pointer',fontSize:13,fontWeight:fd.category===cat?600:400}}>{cat}</button>;
                })}
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>담당자 (정)</label>
                <input value={fd.assignee||''} onChange={e=>setFd({...fd,assignee:e.target.value})} style={inp()} /></div>
              <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>담당자 (부)</label>
                <input value={fd.subAssignee||''} onChange={e=>setFd({...fd,subAssignee:e.target.value})} style={inp()} /></div>
            </div>
            <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>설명</label>
              <textarea value={fd.description||''} onChange={e=>setFd({...fd,description:e.target.value})} style={{...inp(),height:80,resize:'vertical'} as any} /></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>시작일</label>
                <input type="date" value={fd.startDate} onChange={e=>setFd({...fd,startDate:e.target.value})} style={inp()} /></div>
              <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>종료일</label>
                <input type="date" value={fd.endDate} onChange={e=>setFd({...fd,endDate:e.target.value})} style={inp()} /></div>
            </div>
            <div><label style={{display:'block',fontSize:14,fontWeight:500,marginBottom:4}}>진행률: <span style={{color:'#3b82f6',fontWeight:'bold'}}>{fd.progress}%</span></label>
              <input type="range" min="0" max="100" value={fd.progress} onChange={e=>setFd({...fd,progress:Number(e.target.value)})} style={{width:'100%'}} /></div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:24}}>
            <button onClick={onClose} style={{padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:8,background:'white',cursor:'pointer',fontSize:14}}>취소</button>
            <button onClick={()=>{updateTask(pid,task.id,fd);onClose();}} style={{padding:'8px 16px',border:'none',borderRadius:8,background:'#3b82f6',color:'white',cursor:'pointer',fontSize:14,fontWeight:500}}>저장</button>
          </div>
        </div>
      </div>
    );
  };

  const ChangePwModal = () => {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw]         = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [pwError, setPwError]     = useState('');
    const [pwSuccess, setPwSuccess] = useState(false);
    const [pwLoading, setPwLoading] = useState(false);

    const handleChange = async () => {
      setPwError(''); setPwSuccess(false);
      if (!currentPw || !newPw || !confirmPw) { setPwError('모든 항목을 입력해주세요.'); return; }
      if (newPw.length < 6) { setPwError('새 비밀번호는 6자 이상이어야 합니다.'); return; }
      if (newPw !== confirmPw) { setPwError('새 비밀번호가 일치하지 않습니다.'); return; }
      setPwLoading(true);
      try {
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPw });
        if (signInErr) { setPwError('현재 비밀번호가 올바르지 않습니다.'); setPwLoading(false); return; }
        const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
        if (updateErr) { setPwError('비밀번호 변경 중 오류가 발생했습니다.'); }
        else { setPwSuccess(true); setTimeout(() => setShowChangePw(false), 1500); }
      } catch { setPwError('오류가 발생했습니다.'); }
      finally { setPwLoading(false); }
    };

    const inp2 = () => ({width:'100%',border:'1px solid #d1d5db',borderRadius:8,padding:'9px 12px',fontSize:14,boxSizing:'border-box' as const,outline:'none'});

    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,padding:16}}
        onClick={()=>setShowChangePw(false)}>
        <div style={{background:'white',borderRadius:14,padding:28,width:Math.min(400,window.innerWidth*0.95),boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
          onClick={e=>e.stopPropagation()}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <div>
              <h3 style={{margin:0,fontSize:17,fontWeight:'bold'}}>🔑 비밀번호 변경</h3>
              <p style={{margin:'4px 0 0',fontSize:12,color:'#9ca3af'}}>{user.email}</p>
            </div>
            <button onClick={()=>setShowChangePw(false)} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:'#9ca3af'}}>✕</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div>
              <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:'#374151'}}>현재 비밀번호</label>
              <input type="password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} placeholder="현재 비밀번호" style={inp2()} />
            </div>
            <div>
              <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:'#374151'}}>새 비밀번호 <span style={{fontSize:11,color:'#9ca3af',fontWeight:400}}>(6자 이상)</span></label>
              <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="새 비밀번호" style={inp2()} />
            </div>
            <div>
              <label style={{display:'block',fontSize:13,fontWeight:500,marginBottom:5,color:'#374151'}}>새 비밀번호 확인</label>
              <input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&handleChange()}
                placeholder="새 비밀번호 재입력" style={inp2()} />
            </div>
            {pwError && (
              <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'10px 14px',fontSize:13,color:'#dc2626'}}>⚠️ {pwError}</div>
            )}
            {pwSuccess && (
              <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'10px 14px',fontSize:13,color:'#16a34a'}}>✅ 비밀번호가 변경되었습니다!</div>
            )}
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:22}}>
            <button onClick={()=>setShowChangePw(false)} style={{padding:'8px 16px',border:'1px solid #d1d5db',borderRadius:8,background:'white',cursor:'pointer',fontSize:14}}>취소</button>
            <button onClick={handleChange} disabled={pwLoading}
              style={{padding:'8px 20px',border:'none',borderRadius:8,background:pwLoading?'#93c5fd':'#3b82f6',color:'white',cursor:pwLoading?'not-allowed':'pointer',fontSize:14,fontWeight:500}}>
              {pwLoading ? '변경 중...' : '변경하기'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const HistoryModal = () => (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,padding:16}}
      onClick={()=>setShowHistory(false)}>
      <div style={{background:'white',borderRadius:12,padding:24,width:Math.min(480, window.innerWidth*0.95),maxHeight:'75vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
        onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexShrink:0}}>
          <div>
            <h3 style={{margin:0,fontSize:18,fontWeight:'bold'}}>🕐 저장 히스토리</h3>
            <p style={{margin:'4px 0 0',fontSize:12,color:'#9ca3af'}}>최근 50개 스냅샷 · 복원 버튼으로 해당 시점으로 되돌리기</p>
          </div>
          <button onClick={()=>setShowHistory(false)} style={{border:'none',background:'none',cursor:'pointer',fontSize:20,color:'#9ca3af',flexShrink:0}}>✕</button>
        </div>
        <div style={{overflowY:'auto',flex:1}}>
          {historyLoading ? (
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'48px 0',gap:10,color:'#6b7280'}}>
              <div style={{width:20,height:20,border:'3px solid #a78bfa',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
              <span style={{fontSize:14}}>불러오는 중...</span>
            </div>
          ) : history.length === 0 ? (
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'48px 0',color:'#9ca3af',gap:8}}>
              <span style={{fontSize:32}}>📭</span>
              <span style={{fontSize:14}}>저장 히스토리가 없습니다.</span>
            </div>
          ) : history.map((h, i) => (
            <div key={h.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',borderRadius:10,marginBottom:6,background:i===0?'#f5f3ff':'#f9fafb',border:`1px solid ${i===0?'#c4b5fd':'#e5e7eb'}`,transition:'background 0.15s'}}>
              <div style={{minWidth:0,flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{fontSize:13,fontWeight:600,color:'#1f2937'}}>
                    {new Date(h.saved_at).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                  </span>
                  {i===0 && <span style={{fontSize:11,color:'#7c3aed',background:'#ede9fe',padding:'1px 8px',borderRadius:10,fontWeight:600}}>최신</span>}
                </div>
                {h.memo && (
                  <div style={{fontSize:12,color:'#6b7280',marginTop:3,display:'flex',alignItems:'center',gap:4}}>
                    <span style={{opacity:0.6}}>📝</span>
                    <span>{h.memo}</span>
                  </div>
                )}
              </div>
              <button
                onClick={()=>restoreHistory(h.id)}
                disabled={restoring}
                style={{padding:'6px 14px',background:restoring?'#e5e7eb':'#7c3aed',color:restoring?'#9ca3af':'white',border:'none',borderRadius:7,cursor:restoring?'not-allowed':'pointer',fontSize:12,fontWeight:600,flexShrink:0,marginLeft:12,whiteSpace:'nowrap'}}>
                {restoring ? '복원 중...' : '복원'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',flexDirection:'column',gap:12,color:'#6b7280'}}>
      <div style={{width:32,height:32,border:'4px solid #93c5fd',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
      <p style={{fontSize:14,margin:0,fontFamily:"'Pretendard',-apple-system,BlinkMacSystemFont,sans-serif"}}>Supabase에서 불러오는 중...</p>
      <style>{`@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css'); @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const totalW = LEFT_COL + ASSIGNEE_COL + SUB_COL + TIMELINE_W;

  return (
    <div style={{height:'100vh',width:'100%',background:'#eef0f5',display:'flex',flexDirection:'column',overflow:'hidden',fontFamily:"'Pretendard',-apple-system,BlinkMacSystemFont,sans-serif"}}>
      <style>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeInDown{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeOut{from{opacity:1}to{opacity:0}}
        *{box-sizing:border-box; font-family:'Pretendard',-apple-system,BlinkMacSystemFont,sans-serif;}
      `}</style>

      {/* Realtime 수신 토스트 - 헤더에서 인라인으로 표시 */}

      {/* Header */}
      <div ref={headerRef} style={{background:'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 60%, #16213e 100%)',borderBottom:'1px solid rgba(255,255,255,0.08)',padding:'16px 24px',flexShrink:0,boxShadow:'0 2px 16px rgba(0,0,0,0.4)',position:'sticky',top:0,zIndex:30}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div>
              {/* 앱 전환 토글 */}
              <div style={{display:'flex',alignItems:'center',gap:0,background:'rgba(255,255,255,0.07)',borderRadius:10,padding:4,border:'1px solid rgba(255,255,255,0.1)'}}>
                {([2,1] as const).map(id => (
                  <button key={id} onClick={()=>onAppChange(id)}
                    style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:8,border:'none',cursor:'pointer',transition:'all 0.2s',
                      background: appId===id ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
                      color: appId===id ? '#fff' : 'rgba(148,163,184,0.7)',
                      fontWeight: appId===id ? 700 : 400,
                      fontSize: 14,
                      boxShadow: appId===id ? '0 2px 8px rgba(99,102,241,0.4)' : 'none',
                    }}>
                    {id===2 ? '샌디앱 간트차트' : '통근버스 간트차트'}
                  </button>
                ))}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:2}}>
                <p style={{fontSize:11,color:'rgba(148,163,184,0.8)',margin:0}}>2026년 · Supabase 연동 · 실시간 동기화 🟢</p>
                {realtimeToast && (
                  <span style={{fontSize:11,color:'#4ade80',background:'rgba(74,222,128,0.12)',padding:'2px 8px',borderRadius:10,border:'1px solid rgba(74,222,128,0.25)',fontWeight:600,animation:'fadeInDown 0.3s ease',display:'flex',alignItems:'center',gap:4}}>
                    🔄 다른 팀원이 업데이트했습니다
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
            {saving && (
              <div style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'#4ade80',background:'rgba(74,222,128,0.1)',padding:'4px 10px',borderRadius:20,border:'1px solid rgba(74,222,128,0.2)'}}>
                <div style={{width:10,height:10,border:'2px solid #4ade80',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />저장 중...
              </div>
            )}
            <div style={{position:'relative'}}>
              <span style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',color:'rgba(148,163,184,0.6)',fontSize:12}}>🔍</span>
              <input type="text" placeholder="검색..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                style={{paddingLeft:28,paddingRight:10,height:30,border:'1px solid rgba(255,255,255,0.12)',borderRadius:7,width:150,fontSize:12,outline:'none',background:'rgba(255,255,255,0.07)',color:'#f1f5f9'}} />
            </div>
            <button onClick={loadHistory}
              style={{display:'flex',alignItems:'center',gap:5,height:30,padding:'0 11px',background:'rgba(124,58,237,0.85)',color:'white',border:'1px solid rgba(167,139,250,0.3)',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:500,boxShadow:'0 1px 4px rgba(124,58,237,0.3)'}}>
              🕐 히스토리
            </button>
            <button onClick={exportCSV}
              style={{display:'flex',alignItems:'center',gap:5,height:30,padding:'0 11px',background:'rgba(22,163,74,0.85)',color:'white',border:'1px solid rgba(74,222,128,0.2)',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:500,boxShadow:'0 1px 4px rgba(22,163,74,0.25)'}}>
              ⬇ CSV
            </button>
            <div style={{display:'flex',alignItems:'center',background:'rgba(255,255,255,0.07)',borderRadius:8,border:'1px solid rgba(255,255,255,0.12)',padding:2,gap:2}}>
              <span style={{fontSize:10,color:'rgba(148,163,184,0.5)',padding:'0 4px',userSelect:'none'}}>🔍</span>
              {([
                ['year','월','12개월 한화면'] as const,
                ['half','월↔','6개월씩 스크롤'] as const,
                ['week','주','주단위 스크롤'] as const,
                ['day','일','일단위 스크롤'] as const,
              ]).map(([mode,label,title])=>(
                <button key={mode} onClick={()=>setViewMode(mode)} title={title}
                  style={{height:26,padding:'0 10px',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:viewMode===mode?700:400,
                    background:viewMode===mode?'rgba(99,102,241,0.9)':'transparent',
                    color:viewMode===mode?'white':'rgba(148,163,184,0.8)',
                    transition:'all 0.15s'}}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={addProject}
              style={{display:'flex',alignItems:'center',gap:5,height:30,padding:'0 13px',background:'linear-gradient(135deg,#6366f1,#8b5cf6)',color:'white',border:'none',borderRadius:7,cursor:'pointer',fontSize:12,fontWeight:600,boxShadow:'0 2px 6px rgba(99,102,241,0.4)'}}>
              + 프로젝트 추가
            </button>
            <div style={{display:'flex',alignItems:'center',gap:6,paddingLeft:8,borderLeft:'1px solid rgba(255,255,255,0.12)'}}>
              <span style={{fontSize:11,color:'rgba(148,163,184,0.6)',maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{user.email}</span>
              <button onClick={()=>setShowChangePw(true)} title="비밀번호 변경"
                style={{height:30,padding:'0 9px',background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:7,cursor:'pointer',fontSize:11,color:'rgba(148,163,184,0.8)',fontWeight:500,display:'flex',alignItems:'center'}}>
                🔑 비번변경
              </button>
              <button onClick={onLogout} title="로그아웃"
                style={{height:30,padding:'0 9px',background:'rgba(239,68,68,0.15)',border:'1px solid rgba(239,68,68,0.25)',borderRadius:7,cursor:'pointer',fontSize:11,color:'#fca5a5',fontWeight:500,display:'flex',alignItems:'center'}}>
                로그아웃
              </button>
            </div>
          </div>
        </div>

        {/* 카테고리 + 그룹 필터 */}
        <div style={{display:'flex',gap:6,marginTop:12,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'#e2e8f0',flexShrink:0,fontWeight:600}}>카테고리:</span>
          <button onClick={()=>setActiveCategories([])}
            style={{padding:'5px 14px',borderRadius:20,fontSize:12,cursor:'pointer',fontWeight:activeCategories.length===0?600:400,border:activeCategories.length===0?'1.5px solid #818cf8':'1.5px solid rgba(255,255,255,0.4)',background:activeCategories.length===0?'rgba(99,102,241,0.35)':'rgba(255,255,255,0.12)',color:activeCategories.length===0?'#fff':'#e2e8f0'}}>
            전체 <span style={{marginLeft:2,fontSize:11,opacity:0.9}}>{projects.length}</span>
          </button>
          {CATEGORIES.map(cat=>{
            const isActive=activeCategories.includes(cat);
            const cc=CATEGORY_COLORS[cat];
            return (
              <button key={cat} onClick={()=>setActiveCategories(prev=>prev.includes(cat)?prev.filter(c=>c!==cat):[...prev,cat])}
                style={{padding:'5px 14px',borderRadius:20,fontSize:12,cursor:'pointer',fontWeight:isActive?600:400,border:isActive?`1.5px solid ${cc.border}`:'1.5px solid rgba(255,255,255,0.4)',background:isActive?`${cc.bg}33`:'rgba(255,255,255,0.12)',color:isActive?cc.border:'#e2e8f0'}}>
                {cat} <span style={{marginLeft:2,fontSize:11,opacity:0.9}}>{projects.filter(p=>p.category===cat).length}</span>
              </button>
            );
          })}
          {activeCategories.length>0 && <button onClick={()=>setActiveCategories([])} style={{fontSize:11,color:'#94a3b8',background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>초기화</button>}
          {allGroups.length > 0 && <>
            <div style={{width:1,height:16,background:'rgba(255,255,255,0.3)',flexShrink:0,marginLeft:4}} />
            <span style={{fontSize:12,color:'#e2e8f0',flexShrink:0,fontWeight:600}}>그룹:</span>
            <button onClick={()=>setActiveGroup('')}
              style={{padding:'5px 14px',borderRadius:20,fontSize:12,cursor:'pointer',fontWeight:activeGroup===''?600:400,border:activeGroup===''?'1.5px solid #818cf8':'1.5px solid rgba(255,255,255,0.4)',background:activeGroup===''?'rgba(99,102,241,0.35)':'rgba(255,255,255,0.12)',color:activeGroup===''?'#fff':'#e2e8f0'}}>
              전체
            </button>
            {allGroups.map(g=>(
              <button key={g} onClick={()=>setActiveGroup(prev=>prev===g?'':g)}
                style={{padding:'5px 14px',borderRadius:20,fontSize:12,cursor:'pointer',fontWeight:activeGroup===g?600:400,border:activeGroup===g?'1.5px solid #818cf8':'1.5px solid rgba(255,255,255,0.4)',background:activeGroup===g?'rgba(99,102,241,0.35)':'rgba(255,255,255,0.12)',color:activeGroup===g?'#fff':'#e2e8f0'}}>
                {g} <span style={{fontSize:11,opacity:0.9}}>{projects.filter(p=>(p.group||'미분류')===g).length}</span>
              </button>
            ))}
          </>}
        </div>

        {/* Legend */}
        <div style={{display:'flex',alignItems:'center',gap:16,marginTop:10,flexWrap:'wrap',paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.15)'}}>
          <div style={{display:'flex',alignItems:'center',gap:5,flexShrink:0}}>
            {(['영업','기획','운영','개발','보안'] as string[]).map(cat=>{
              const cc = ({'영업':{bg:'#fef3c7',text:'#92400e',border:'#f59e0b'},'기획':{bg:'#fce7f3',text:'#9d174d',border:'#ec4899'},'운영':{bg:'#e0f2fe',text:'#075985',border:'#0ea5e9'},'개발':{bg:'#d1fae5',text:'#065f46',border:'#10b981'},'보안':{bg:'#fee2e2',text:'#991b1b',border:'#ef4444'}} as any)[cat];
              return <span key={cat} style={{fontSize:11,padding:'2px 8px',borderRadius:10,background:cc.bg,color:cc.text,border:`1px solid ${cc.border}`,fontWeight:600,whiteSpace:'nowrap'}}>{cat}</span>;
            })}
          </div>
          <div style={{width:1,height:14,background:'rgba(255,255,255,0.3)',flexShrink:0}} />
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:10,height:10,borderRadius:'50%',background:'#f87171'}} /><span style={{fontSize:12,color:'#e2e8f0'}}>오늘</span></div>
            <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:28,height:9,borderRadius:3,background:'linear-gradient(to right,#3b82f6 50%,#bfdbfe 50%)'}} /><span style={{fontSize:12,color:'#e2e8f0'}}>진행률</span></div>
            <span style={{fontSize:12,color:'#94a3b8'}}>⠿ 드래그로 순서 변경 | 바 드래그로 일정 조정 | 그룹명 더블클릭 이름 변경</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div style={{overflowX:'auto',overflowY:'auto',flex:1}}>
        <div style={{minWidth:totalW}}>
          {/* Column Header */}
          {(viewMode === 'day' || viewMode === 'week') ? (
            // ── 일/주 뷰: 2단 헤더 — 월 띠 14px + 날짜/주 행 28px = 42px (월 보기와 동일)
            <div style={{position:'sticky',top:0,zIndex:20,background:'white',borderBottom:'2px solid #e2e8f0',boxShadow:'0 1px 3px rgba(0,0,0,0.05)',width:totalW}}>
              {/* 1행: 월 띠 (20px) */}
              <div style={{display:'flex',height:20,borderBottom:'1px solid #e8ecf8'}}>
                <div style={{width:LEFT_COL+ASSIGNEE_COL+SUB_COL,minWidth:LEFT_COL+ASSIGNEE_COL+SUB_COL,flexShrink:0,background:'#f9fafb',borderRight:'1px solid #e5e7eb',position:'sticky',left:0,zIndex:10}} />
                <div style={{display:'flex',width:TIMELINE_W,minWidth:TIMELINE_W,flexShrink:0,overflow:'hidden'}}>
                  {(viewMode === 'day' ? DAY_HEADERS : WEEK_HEADERS).reduce((acc: any[], h: any) => {
                    const isFirst = viewMode === 'day' ? h.isFirst : h.isFirstOfMonth;
                    if (isFirst || acc.length === 0) acc.push({ month: h.month, count: 1 });
                    else acc[acc.length - 1].count++;
                    return acc;
                  }, []).map((seg: any, i: number) => (
                    <div key={i} style={{
                      width: seg.count * MONTH_COL, minWidth: seg.count * MONTH_COL, flexShrink: 0,
                      height: 20,
                      background: ['#eff6ff','#f0fdf4','#fef3c7','#fdf4ff','#fff7ed','#f0fdfa','#fef9c3','#faf5ff','#fff1f2','#f0f9ff','#fefce8','#f5f3ff'][i % 12],
                      borderRight: '1px solid #e8ecf8',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      <span style={{fontSize:10,fontWeight:700,color:'#374151',whiteSpace:'nowrap'}}>{seg.month}월</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* 2행: 날짜 or 주 번호 (22px) */}
              <div style={{display:'flex',height:22}}>
                <div style={{width:LEFT_COL,minWidth:LEFT_COL,flexShrink:0,padding:'0 16px',fontWeight:600,fontSize:13,color:'#374151',borderRight:'1px solid #e5e7eb',background:'#f9fafb',position:'sticky',left:0,zIndex:10,display:'flex',alignItems:'center'}}>프로젝트 / Task</div>
                <div style={{width:ASSIGNEE_COL,minWidth:ASSIGNEE_COL,flexShrink:0,fontWeight:600,fontSize:12,color:'#374151',borderRight:'1px solid #e5e7eb',background:'#f9fafb',textAlign:'center',position:'sticky',left:LEFT_COL,zIndex:10,display:'flex',alignItems:'center',justifyContent:'center'}}>담당(정)</div>
                <div style={{width:SUB_COL,minWidth:SUB_COL,flexShrink:0,fontWeight:600,fontSize:12,color:'#374151',borderRight:'1px solid #e5e7eb',background:'#f9fafb',textAlign:'center',position:'sticky',left:LEFT_COL+ASSIGNEE_COL,zIndex:10,display:'flex',alignItems:'center',justifyContent:'center'}}>담당(부)</div>
                <div style={{display:'flex',width:TIMELINE_W,minWidth:TIMELINE_W,flexShrink:0,overflow:'hidden'}}>
                  {viewMode === 'week'
                    ? WEEK_HEADERS.map((h,i)=>(
                        <div key={i} style={{
                          width:MONTH_COL,minWidth:MONTH_COL,flexShrink:0,
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:12,fontWeight:h.isFirstOfMonth?700:500,
                          color:h.isFirstOfMonth?'#1d4ed8':'#4b5563',
                          borderRight:'1px solid #e8ecf8',
                          background:h.isFirstOfMonth?'#eff6ff':'#f9fafb',
                        }}>{h.label}</div>
                      ))
                    : DAY_HEADERS.map((h,i)=>(
                        <div key={i} style={{
                          width:MONTH_COL,minWidth:MONTH_COL,flexShrink:0,
                          display:'flex',alignItems:'center',justifyContent:'center',
                          fontSize:11,fontWeight:h.isFirst?600:400,
                          color:h.isFirst?'#1d4ed8':'#6b7280',
                          borderRight:'1px solid #e8ecf8',
                          background:h.isFirst?'#eff6ff':'#f9fafb',
                        }}>{h.day}</div>
                      ))
                  }
                </div>
              </div>
            </div>
          ) : (
            // ── 연도/반년 뷰: 1단 헤더 (42px 고정 — 일/주 2단 헤더와 동일)
            <div style={{display:'flex',position:'sticky',top:0,zIndex:20,background:'white',borderBottom:'1px solid #e5e7eb',boxShadow:'0 1px 3px rgba(0,0,0,0.05)',width:totalW,height:42}}>
              <div style={{width:LEFT_COL,minWidth:LEFT_COL,flexShrink:0,padding:'0 16px',fontWeight:600,fontSize:14,color:'#374151',borderRight:'1px solid #e5e7eb',background:'#f9fafb',position:'sticky',left:0,zIndex:10,display:'flex',alignItems:'center'}}>프로젝트 / Task</div>
              <div style={{width:ASSIGNEE_COL,minWidth:ASSIGNEE_COL,flexShrink:0,fontWeight:600,fontSize:13,color:'#374151',borderRight:'1px solid #e5e7eb',background:'#f9fafb',textAlign:'center',position:'sticky',left:LEFT_COL,zIndex:10,display:'flex',alignItems:'center',justifyContent:'center'}}>담당(정)</div>
              <div style={{width:SUB_COL,minWidth:SUB_COL,flexShrink:0,fontWeight:600,fontSize:13,color:'#374151',borderRight:'1px solid #e5e7eb',background:'#f9fafb',textAlign:'center',position:'sticky',left:LEFT_COL+ASSIGNEE_COL,zIndex:10,display:'flex',alignItems:'center',justifyContent:'center'}}>담당(부)</div>
              <div style={{display:'flex',width:TIMELINE_W,minWidth:TIMELINE_W,flexShrink:0,alignItems:'center'}}>
                {MONTH_LABELS.map((m,i)=>(
                  <div key={i} style={{width:MONTH_COL,minWidth:MONTH_COL,flexShrink:0,textAlign:'center',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:600,color:'#4b5563',borderRight:i<11?'1px solid #e5e7eb':'none',background:'#f9fafb'}}>{m}</div>
                ))}
              </div>
            </div>
          )}

          {/* Rows */}
          <div style={{width:totalW}}>
            {groupedFiltered.length===0 ? (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'96px 0',color:'#9ca3af',fontSize:14,gap:12}}>
                <span>프로젝트가 없습니다.</span>
                <button onClick={addProject} style={{color:'#3b82f6',background:'none',border:'none',cursor:'pointer',fontSize:13}}>+ 프로젝트 추가하기</button>
              </div>
            ) : groupedFiltered.map(group=>(
              <React.Fragment key={group.name}>
                {/* 그룹 헤더 */}
                <div draggable
                  onDragStart={e=>handleRowDragStart(e,{type:'group',name:group.name})}
                  onDragOver={e=>handleRowDragOver(e,{type:'group',name:group.name})}
                  onDrop={e=>handleRowDrop(e,{type:'group',name:group.name})}
                  onDragEnd={handleRowDragEnd}
                  style={{display:'flex',borderBottom:'2px solid #e5e7eb',background: rowDragOver?.type==='group'&&rowDragOver?.name===group.name?'#e0e7ff':'#f0f4ff',width:totalW,opacity:rowDrag?.type==='group'&&rowDrag?.name===group.name?0.5:1,transition:'background 0.1s'}}>
                  <div style={{width:LEFT_COL,minWidth:LEFT_COL,flexShrink:0,display:'flex',alignItems:'center',padding:'8px 12px',gap:8,borderRight:'1px solid #e5e7eb',position:'sticky',left:0,zIndex:8,background:'inherit',borderLeft:'4px solid #6366f1'}}>
                    <span style={{fontSize:14,color:'#9ca3af',cursor:'grab',userSelect:'none',padding:'0 2px'}} title="드래그하여 그룹 순서 변경">⠿</span>
                    <button onClick={()=>toggleGroup(group.name)} style={{border:'none',background:'none',cursor:'pointer',padding:2,fontSize:13,color:'#6366f1'}}>
                      {collapsedGroups.has(group.name)?'▶':'▼'}
                    </button>
                    <span style={{fontSize:15,color:'#6366f1'}}>📁</span>
                    {editingGroupName===group.name ? (
                      <input autoFocus value={editingGroupValue}
                        onChange={e=>setEditingGroupValue(e.target.value)}
                        onBlur={()=>{renameGroup(group.name,editingGroupValue);setEditingGroupName(null);}}
                        onKeyDown={e=>{
                          if(e.key==='Enter'){renameGroup(group.name,editingGroupValue);setEditingGroupName(null);}
                          if(e.key==='Escape')setEditingGroupName(null);
                        }}
                        style={{fontSize:13,fontWeight:700,border:'1px solid #6366f1',borderRadius:4,padding:'2px 6px',outline:'none',minWidth:120}}
                      />
                    ) : (
                      <span onDoubleClick={()=>{setEditingGroupName(group.name);setEditingGroupValue(group.name);}}
                        title="더블클릭하여 이름 변경"
                        style={{fontSize:16,fontWeight:800,color:'#1e293b',cursor:'text'}}>
                        {group.name}
                      </span>
                    )}
                    <span style={{fontSize:12,color:'#9ca3af',marginLeft:4}}>({group.items.length}개 프로젝트)</span>
                  </div>
                  <div style={{width:ASSIGNEE_COL,minWidth:ASSIGNEE_COL,flexShrink:0,borderRight:'1px solid #e5e7eb',position:'sticky',left:LEFT_COL,zIndex:8,background:'inherit'}} />
                  <div style={{width:SUB_COL,minWidth:SUB_COL,flexShrink:0,borderRight:'1px solid #e5e7eb',position:'sticky',left:LEFT_COL+ASSIGNEE_COL,zIndex:8,background:'inherit'}} />
                  <div style={{width:TIMELINE_W,minWidth:TIMELINE_W,flexShrink:0,position:'relative',minHeight:(()=>{
                    if (!collapsedGroups.has(group.name)) return 44;
                    // lane 패킹으로 실제 필요 높이 계산
                    const ROW_H=22,GAP=4,BAR_GAP_PX=6;
                    const bars = group.items.map((proj:any)=>{
                      const tasks=proj.tasks.filter((t:any)=>t.startDate&&t.endDate);
                      const sd=tasks.length?[...tasks].sort((a:any,b:any)=>a.startDate.localeCompare(b.startDate))[0].startDate:(proj.startDate||'');
                      const ed=tasks.length?[...tasks].sort((a:any,b:any)=>b.endDate.localeCompare(a.endDate))[0].endDate:(proj.endDate||'');
                      return getPos(sd,ed);
                    }).filter(Boolean);
                    const sorted=[...bars].sort((a:any,b:any)=>a.left-b.left);
                    const laneEnds:number[]=[];
                    sorted.forEach((pos:any)=>{
                      const li=laneEnds.findIndex(e=>e+BAR_GAP_PX<=pos.left);
                      const lane=li===-1?laneEnds.length:li;
                      laneEnds[lane]=pos.left+pos.width;
                    });
                    const laneCount=laneEnds.length||1;
                    return Math.max(44,laneCount*(ROW_H+GAP)-GAP+12);
                  })()}}>
                    {GridLines}
                    {todayLeft!==null && <div style={{position:'absolute',left:todayLeft,top:0,bottom:0,width:2,background:'#ef4444',opacity:0.3,zIndex:5}} />}
                    {collapsedGroups.has(group.name) && (()=>{
                      // 프로젝트별 실제 기간 계산
                      const projBars = group.items.map((proj:any) => {
                        const c = COLOR_MAP[proj.color] || COLOR_MAP.blue;
                        const catColor = CATEGORY_COLORS[proj.category];
                        const barBg = catColor ? catColor.border : c.bar;
                        const barBgLight = catColor ? catColor.bg : c.barLight;
                        const { startDate, endDate } = (() => {
                          const tasks = proj.tasks.filter((t:any) => t.startDate && t.endDate);
                          if (tasks.length === 0) return { startDate: proj.startDate||'', endDate: proj.endDate||'' };
                          const starts = tasks.map((t:any) => t.startDate).sort();
                          const ends = tasks.map((t:any) => t.endDate).sort();
                          return { startDate: starts[0], endDate: ends[ends.length-1] };
                        })();
                        const pos = getPos(startDate, endDate);
                        return { proj, startDate, endDate, pos, barBg, barBgLight };
                      });

                      // assignLanes와 동일한 로직으로 프로젝트 기간바 레인 배정
                      const BAR_GAP_PX = 6;
                      const ROW_H = 22;
                      const GAP = 4;
                      const laneEnds: number[] = [];
                      const sorted = [...projBars]
                        .map((item, origIdx) => ({ item, origIdx }))
                        .sort((a, b) => (a.item.startDate||'').localeCompare(b.item.startDate||''));
                      const laned: { item: any; lane: number }[] = new Array(projBars.length);
                      sorted.forEach(({ item, origIdx }) => {
                        if (!item.pos) { laned[origIdx] = { item, lane: 0 }; return; }
                        const laneIdx = laneEnds.findIndex(end => end + BAR_GAP_PX <= item.pos!.left);
                        const lane = laneIdx === -1 ? laneEnds.length : laneIdx;
                        laneEnds[lane] = item.pos!.left + item.pos!.width;
                        laned[origIdx] = { item, lane };
                      });

                      const laneCount = laned.length > 0 ? Math.max(...laned.map(l=>l.lane)) + 1 : 1;
                      const totalH = laneCount * (ROW_H + GAP) - GAP;
                      const containerH = Math.max(44, totalH + 12);
                      const topBase = (containerH - totalH) / 2;

                      return laned.map(({ item, lane }, _idx) => {
                        if (!item.pos) return null;
                        const topOffset = topBase + lane * (ROW_H + GAP);
                        return (
                          <div key={item.proj.id}
                            onMouseEnter={e=>{setTooltip({startDate:item.startDate,endDate:item.endDate,name:item.proj.name});setTooltipPos({x:e.clientX,y:e.clientY});}}
                            onMouseMove={e=>setTooltipPos({x:e.clientX,y:e.clientY})}
                            onMouseLeave={()=>setTooltip(null)}
                            style={{position:'absolute',left:item.pos.left,width:item.pos.width,height:ROW_H,top:topOffset,background:item.barBg,borderRadius:4,opacity:0.9,zIndex:6,cursor:'default',display:'flex',alignItems:'center',overflow:'hidden',minWidth:4,border:`1px solid ${item.barBg}`,boxShadow:`0 1px 4px ${item.barBg}55`}}>
                            {item.pos.width > 40 && (
                              <span style={{fontSize:11,color:'white',fontWeight:700,padding:'0 8px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',lineHeight:1,textShadow:'0 1px 3px rgba(0,0,0,0.5)',maxWidth:item.pos.width-4}}>
                                {item.proj.name}
                              </span>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* 그룹 내 프로젝트 */}
                {!collapsedGroups.has(group.name) && group.items.map(proj=>{
                  const c=COLOR_MAP[proj.color]||COLOR_MAP.blue;
                  const {pos:projPos,progress:projProg}=getProjectMeta(proj);
                  const catColor=CATEGORY_COLORS[proj.category];
                  return (
                    <React.Fragment key={proj.id}>
                      {/* Project row */}
                      <div draggable
                        onDragStart={e=>handleRowDragStart(e,{type:'project',id:proj.id,group:proj.group||'미분류'})}
                        onDragOver={e=>handleRowDragOver(e,{type:'project',id:proj.id,group:proj.group||'미분류'})}
                        onDrop={e=>handleRowDrop(e,{type:'project',id:proj.id,group:proj.group||'미분류'})}
                        onDragEnd={handleRowDragEnd}
                        style={{display:'flex',borderBottom:'1px solid #e5e7eb',background:rowDragOver?.type==='project'&&rowDragOver?.id===proj.id?'#dbeafe':c.rowBg,opacity:rowDrag?.type==='project'&&rowDrag?.id===proj.id?0.5:1,transition:'background 0.1s'}}>
                        <div style={{width:LEFT_COL,minWidth:LEFT_COL,flexShrink:0,display:'flex',alignItems:'flex-start',padding:'8px 12px 8px 20px',borderRight:'1px solid #e5e7eb',gap:8,position:'sticky',left:0,zIndex:8,background:'inherit'}}>
                          <span style={{fontSize:14,color:'#d1d5db',cursor:'grab',userSelect:'none',marginTop:4,flexShrink:0}} title="드래그하여 순서 변경">⠿</span>
                          <button onClick={()=>toggleProject(proj.id)} style={{flexShrink:0,padding:2,borderRadius:4,border:'none',background:'none',cursor:'pointer',marginTop:2}}>
                            <span style={{color:c.text,fontSize:14}}>{proj.expanded?'▼':'▶'}</span>
                          </button>
                          <div style={{width:4,borderRadius:2,flexShrink:0,alignSelf:'stretch',background:c.border}} />
                          <div style={{flex:1,minWidth:0,padding:'4px 0'}}>
                            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                              {catColor && <span style={{fontSize:12,padding:'2px 8px',borderRadius:10,background:catColor.bg,color:catColor.text,border:`1px solid ${catColor.border}`,fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}>{proj.category}</span>}
                              <span style={{fontWeight:700,fontSize:15,color:c.text,wordBreak:'break-word',lineHeight:1.4}}>{proj.name}</span>
                            </div>
                            {proj.description && <div style={{fontSize:13,color:c.text,opacity:0.85,wordBreak:'break-word',marginTop:2,lineHeight:1.3}}>{proj.description}</div>}
                          </div>
                          <div style={{display:'flex',gap:4,flexShrink:0,marginTop:4}}>
                            <button onClick={()=>setEditingProject(proj)} style={{padding:4,borderRadius:4,border:'none',background:'none',cursor:'pointer',fontSize:12}}>✏️</button>
                            <button onClick={()=>addTask(proj.id)} style={{padding:4,borderRadius:4,border:'none',background:'none',cursor:'pointer',fontSize:12}}>➕</button>
                            <button onClick={()=>deleteProject(proj.id)} style={{padding:4,borderRadius:4,border:'none',background:'none',cursor:'pointer',fontSize:12}}>🗑️</button>
                          </div>
                        </div>
                        <div style={{width:ASSIGNEE_COL,minWidth:ASSIGNEE_COL,flexShrink:0,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'12px 4px',borderRight:'1px solid #e5e7eb',fontSize:12,color:'#4b5563',textAlign:'center',wordBreak:'break-all',position:'sticky',left:LEFT_COL,zIndex:8,background:'inherit'}}>
                          {proj.owner||<span style={{color:'#d1d5db'}}>-</span>}
                        </div>
                        <div style={{width:SUB_COL,minWidth:SUB_COL,flexShrink:0,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'12px 4px',borderRight:'1px solid #e5e7eb',fontSize:12,color:'#6b7280',textAlign:'center',wordBreak:'break-all',position:'sticky',left:LEFT_COL+ASSIGNEE_COL,zIndex:8,background:'inherit'}}>
                          {proj.subOwner||<span style={{color:'#d1d5db'}}>-</span>}
                        </div>
                        <div style={{width:TIMELINE_W,minWidth:TIMELINE_W,flexShrink:0,position:'relative',display:'flex',alignItems:'center',
                          minHeight: (() => {
                            if (proj.expanded || proj.tasks.length === 0) return 52;
                            const lanes = assignLanes(proj.tasks.filter((t:any)=>t.startDate&&t.endDate));
                            const laneCount = Math.max(1, lanes.length > 0 ? Math.max(...lanes.map((l:any)=>l.lane)) + 1 : 1);
                            return Math.max(52, laneCount * 26 + 12);
                          })()
                        }}>
                          {GridLines}
                          {todayLeft!==null && <div style={{position:'absolute',left:todayLeft,top:0,bottom:0,width:2,background:'#ef4444',opacity:0.7,zIndex:5}} />}
                          {projPos && proj.tasks.length===0 && (()=>{
                            const isProjDrag=dragging?.pid===proj.id && dragging?.tid==='__proj__';
                            return (
                              <div style={{position:'absolute',left:projPos.left,width:projPos.width,height:22,top:'50%',transform:'translateY(-50%)',background:catColor?catColor.bg:c.barLight,borderRadius:4,overflow:'visible',border:`1px solid ${catColor?catColor.border:c.bar}55`,zIndex:6,cursor:'grab'}}
                                onMouseDown={e=>handleMouseDown(e,proj.id,'__proj__','move')}
                                onMouseEnter={e=>{setTooltip({name:proj.name,startDate:proj.startDate,endDate:proj.endDate});setTooltipPos({x:e.clientX,y:e.clientY});}}
                                onMouseMove={e=>setTooltipPos({x:e.clientX,y:e.clientY})}
                                onMouseLeave={()=>{if(!isProjDrag)setTooltip(null);}}>
                                <div style={{position:'absolute',left:0,top:0,bottom:0,width:8,cursor:'ew-resize',zIndex:8,borderRadius:'4px 0 0 4px'}} onMouseDown={e=>handleMouseDown(e,proj.id,'__proj__','start')} />
                                <div style={{width:`${projProg}%`,height:'100%',background:catColor?catColor.border:c.bar,borderRadius:4,overflow:'hidden'}} />
                                {projPos.width>40
                                  ? <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#1f2937',fontWeight:700,pointerEvents:'none'}}>{projProg}%</div>
                                  : <div style={{position:'absolute',left:projPos.width+5,top:'50%',transform:'translateY(-50%)',whiteSpace:'nowrap',fontSize:11,color:'#374151',fontWeight:600,pointerEvents:'none'}}>{projProg}%</div>
                                }
                                <div style={{position:'absolute',right:0,top:0,bottom:0,width:8,cursor:'ew-resize',zIndex:8,borderRadius:'0 4px 4px 0'}} onMouseDown={e=>handleMouseDown(e,proj.id,'__proj__','end')} />
                              </div>
                            );
                          })()}
                          {proj.tasks.length>0 && proj.expanded && projPos && (()=>{
                            const isProjDrag=dragging?.pid===proj.id && dragging?.tid==='__proj__';
                            return (
                              <div style={{position:'absolute',left:projPos.left,width:projPos.width,height:22,top:'50%',transform:'translateY(-50%)',background:catColor?catColor.bg:c.barLight,borderRadius:4,overflow:'hidden',border:`1px solid ${catColor?catColor.border:c.bar}55`,zIndex:6,cursor:'default'}}
                                onMouseEnter={e=>{setTooltip({name:proj.name,startDate:proj.startDate,endDate:proj.endDate});setTooltipPos({x:e.clientX,y:e.clientY});}}
                                onMouseMove={e=>setTooltipPos({x:e.clientX,y:e.clientY})}
                                onMouseLeave={()=>{if(!isProjDrag)setTooltip(null);}}>
                                <div style={{width:`${projProg}%`,height:'100%',background:catColor?catColor.border:c.bar,borderRadius:4}} />
                                {projPos.width>40
                                  ? <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#1f2937',fontWeight:700,pointerEvents:'none'}}>{projProg}%</div>
                                  : <div style={{position:'absolute',left:projPos.width+5,top:'50%',transform:'translateY(-50%)',whiteSpace:'nowrap',fontSize:11,color:'#374151',fontWeight:600,pointerEvents:'none'}}>{projProg}%</div>
                                }
                              </div>
                            );
                          })()}
                          {proj.tasks.length>0 && !proj.expanded && (()=>{
                            const validTasks = proj.tasks.filter((t:any)=>t.startDate&&t.endDate);
                            const laned = assignLanes(validTasks);
                            const laneCount = laned.length > 0 ? Math.max(...laned.map((l:any)=>l.lane)) + 1 : 1;
                            const ROW_H = 20;
                            const GAP = 4;
                            const totalH = laneCount * (ROW_H + GAP) - GAP;
                            const containerH = Math.max(52, totalH + 12);
                            return laned.map(({task, lane, pos: tpos}:any) => {
                              if (!tpos) return null;
                              const taskCatColor = CATEGORY_COLORS[task.category];
                              const tc = COLOR_MAP[proj.color] || COLOR_MAP.blue;
                              const barBg = taskCatColor ? taskCatColor.border : tc.bar;
                              const barBgLight = taskCatColor ? taskCatColor.bg : tc.barLight;
                              const topOffset = (containerH - totalH) / 2 + lane * (ROW_H + GAP);
                              const isDrag = dragging?.pid===proj.id && dragging?.tid===task.id;
                              return (
                                <div key={task.id}
                                  onMouseEnter={e=>{setTooltip({startDate:task.startDate,endDate:task.endDate,name:task.name});setTooltipPos({x:e.clientX,y:e.clientY});}}
                                  onMouseMove={e=>setTooltipPos({x:e.clientX,y:e.clientY})}
                                  onMouseLeave={()=>{if(!isDrag)setTooltip(null);}}
                                  onMouseDown={e=>handleMouseDown(e,proj.id,task.id,'move')}
                                  style={{position:'absolute',left:tpos.left,width:tpos.width,height:ROW_H,top:topOffset,background:barBgLight,borderRadius:3,zIndex:6,cursor:'grab',display:'flex',alignItems:'center',overflow:'visible',minWidth:4,border:`1px solid ${barBg}55`,boxShadow:`0 1px 3px ${barBg}33`}}>
                                  {/* 왼쪽 리사이즈 핸들 */}
                                  <div onMouseDown={e=>handleMouseDown(e,proj.id,task.id,'start')}
                                    style={{position:'absolute',left:0,top:0,bottom:0,width:6,cursor:'ew-resize',zIndex:8,borderRadius:'3px 0 0 3px'}} />
                                  <div style={{width:`${task.progress||0}%`,height:'100%',background:barBg,borderRadius:3,opacity:0.7,pointerEvents:'none'}} />
                                  {tpos.width > 36 && (
                                    <span style={{position:'absolute',left:8,right:8,fontSize:10,color:'#1f2937',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',lineHeight:1,pointerEvents:'none'}}>
                                      {task.name}
                                    </span>
                                  )}
                                  {/* 오른쪽 리사이즈 핸들 */}
                                  <div onMouseDown={e=>handleMouseDown(e,proj.id,task.id,'end')}
                                    style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'ew-resize',zIndex:8,borderRadius:'0 3px 3px 0'}} />
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>

                      {/* Task rows */}
                      {proj.expanded && proj.tasks.map((task:any)=>{
                        const pos=getPos(task.startDate,task.endDate);
                        const isDrag=dragging?.pid===proj.id && dragging?.tid===task.id;
                        return (
                          <div key={task.id} draggable
                            onDragStart={e=>handleRowDragStart(e,{type:'task',tid:task.id,pid:proj.id})}
                            onDragOver={e=>handleRowDragOver(e,{type:'task',tid:task.id,pid:proj.id})}
                            onDrop={e=>handleRowDrop(e,{type:'task',tid:task.id,pid:proj.id})}
                            onDragEnd={handleRowDragEnd}
                            style={{display:'flex',borderBottom:'1px solid #e5e7eb',background:rowDragOver?.type==='task'&&rowDragOver?.tid===task.id?'#f0fdf4':'white',opacity:rowDrag?.type==='task'&&rowDrag?.tid===task.id?0.5:1,transition:'background 0.1s'}}>
                            <div style={{width:LEFT_COL,minWidth:LEFT_COL,flexShrink:0,display:'flex',alignItems:'center',padding:'8px 12px',borderRight:'1px solid #e5e7eb',position:'sticky',left:0,zIndex:8,background:'inherit'}}>
                              <div style={{paddingLeft:36,display:'flex',alignItems:'flex-start',gap:8,width:'100%'}}>
                                <span style={{fontSize:12,color:'#c4b5fd',flexShrink:0,marginTop:3,userSelect:'none'}}>└</span>
                                <span style={{fontSize:14,color:'#d1d5db',cursor:'grab',userSelect:'none',flexShrink:0,marginTop:1}} title="드래그하여 순서 변경">⠿</span>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{display:'flex',alignItems:'center',gap:5,flexWrap:'wrap',marginBottom:2}}>
                                    {task.category && CATEGORY_COLORS[task.category] && (()=>{const cc=CATEGORY_COLORS[task.category];return <span style={{fontSize:11,padding:'1px 7px',borderRadius:8,background:cc.bg,color:cc.text,border:`1px solid ${cc.border}`,fontWeight:600,flexShrink:0,whiteSpace:'nowrap'}}>{task.category}</span>;})()}
                                    <span style={{fontSize:14,color:'#1f2937',wordBreak:'break-word',lineHeight:1.4}}>{task.name}</span>
                                  </div>
                                  {task.description && <div style={{fontSize:13,color:'#6b7280',wordBreak:'break-word'}}>{task.description}</div>}
                                </div>
                                <div style={{display:'flex',gap:4,flexShrink:0,marginTop:2}}>
                                  <button onClick={()=>setEditingTask({task,pid:proj.id})} style={{padding:4,borderRadius:4,border:'none',background:'none',cursor:'pointer',fontSize:12}}>✏️</button>
                                  <button onClick={()=>deleteTask(proj.id,task.id)} style={{padding:4,borderRadius:4,border:'none',background:'none',cursor:'pointer',fontSize:12}}>🗑️</button>
                                </div>
                              </div>
                            </div>
                            <div style={{width:ASSIGNEE_COL,minWidth:ASSIGNEE_COL,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',padding:'8px 4px',borderRight:'1px solid #e5e7eb',fontSize:12,color:'#6b7280',textAlign:'center',wordBreak:'break-all',position:'sticky',left:LEFT_COL,zIndex:8,background:'inherit'}}>
                              {task.assignee||<span style={{color:'#d1d5db'}}>-</span>}
                            </div>
                            <div style={{width:SUB_COL,minWidth:SUB_COL,flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',padding:'8px 4px',borderRight:'1px solid #e5e7eb',fontSize:12,color:'#9ca3af',textAlign:'center',wordBreak:'break-all',position:'sticky',left:LEFT_COL+ASSIGNEE_COL,zIndex:8,background:'inherit'}}>
                              {task.subAssignee||<span style={{color:'#d1d5db'}}>-</span>}
                            </div>
                            <div style={{width:TIMELINE_W,minWidth:TIMELINE_W,flexShrink:0,position:'relative',minHeight:46,display:'flex',alignItems:'center'}}>
                              {GridLines}
                              {todayLeft!==null && <div style={{position:'absolute',left:todayLeft,top:0,bottom:0,width:2,background:'#ef4444',opacity:0.4,zIndex:5}} />}
                              {pos && (
                                <div style={{position:'absolute',left:pos.left,width:pos.width,height:26,top:'50%',transform:'translateY(-50%)',background:catColor?catColor.bg:c.barLight,borderRadius:5,border:`1px solid ${catColor?catColor.border:c.bar}55`,cursor:'grab',zIndex:6,overflow:'visible'}}
                                  onMouseDown={e=>handleMouseDown(e,proj.id,task.id,'move')}
                                  onMouseEnter={e=>{setTooltip({name:task.name,startDate:task.startDate,endDate:task.endDate});setTooltipPos({x:e.clientX,y:e.clientY});}}
                                  onMouseMove={e=>setTooltipPos({x:e.clientX,y:e.clientY})}
                                  onMouseLeave={()=>{if(!isDrag)setTooltip(null);}}>
                                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:8,cursor:'ew-resize',zIndex:8,borderRadius:'5px 0 0 5px'}} onMouseDown={e=>handleMouseDown(e,proj.id,task.id,'start')} />
                                  <div style={{width:`${task.progress||0}%`,height:'100%',background:catColor?catColor.border:c.bar,borderRadius:4,pointerEvents:'none'}} />
                                  {pos.width>40
                                    ? <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,pointerEvents:'none',color:'#1f2937'}}>{task.progress||0}%</div>
                                    : <div style={{position:'absolute',left:pos.width+5,top:'50%',transform:'translateY(-50%)',whiteSpace:'nowrap',fontSize:11,fontWeight:600,pointerEvents:'none',color:'#374151'}}>{task.progress||0}%</div>
                                  }
                                  <div style={{position:'absolute',right:0,top:0,bottom:0,width:8,cursor:'ew-resize',zIndex:8,borderRadius:'0 5px 5px 0'}} onMouseDown={e=>handleMouseDown(e,proj.id,task.id,'end')} />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* 툴팁 */}
      {tooltip?.startDate && (
        <div style={{position:'fixed',left:tooltipPos.x+14,top:tooltipPos.y-8,background:'#111827',color:'white',fontSize:13,padding:'10px 14px',borderRadius:8,whiteSpace:'nowrap',pointerEvents:'none',zIndex:99999,boxShadow:'0 4px 16px rgba(0,0,0,0.45)',lineHeight:1.7,border:'1px solid rgba(255,255,255,0.08)'}}>
          {tooltip.name && <div style={{fontWeight:700,marginBottom:4,color:'#f1f5f9',fontSize:14}}>{tooltip.name}</div>}
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{color:'#6ee7b7',fontWeight:600,fontSize:13}}>▶</span>
            <span style={{color:'#ffffff',fontWeight:600,letterSpacing:'0.3px'}}>{tooltip.startDate}</span>
            <span style={{color:'#9ca3af',fontSize:12,margin:'0 2px'}}>→</span>
            <span style={{color:'#ffffff',fontWeight:600,letterSpacing:'0.3px'}}>{tooltip.endDate}</span>
          </div>
        </div>
      )}

      {editingProject && <ProjectEditModal proj={editingProject} onClose={()=>setEditingProject(null)} />}
      {editingTask && <TaskEditModal task={editingTask.task} pid={editingTask.pid} onClose={()=>setEditingTask(null)} />}
      {showChangePw && <ChangePwModal />}
      {showHistory && <HistoryModal />}
    </div>
  );
}
