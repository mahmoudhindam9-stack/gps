import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertTriangle, ArrowDownLeft, Bell, Boxes, CarFront, Check, Clock3, CreditCard,
  Database, FileClock, Filter, Gauge, Globe2, LayoutDashboard, LogOut, MapPinned,
  Menu, MoreHorizontal, Plus, RefreshCw, Search, Settings2, ShieldCheck, Signal,
  Smartphone, Users, Wifi, X
} from "lucide-react";
import { api, API_BASE, liveSocketUrl, readSession, saveSession } from "./api";
import type { DeviceBundle, DeviceProfile, Health, Page, RoutePoint, Session, User } from "./types";
import MapPanel from "./components/MapPanel";

const pageNames: Record<Page, string> = {
  overview: "نظرة عامة", live: "التتبع المباشر", devices: "الأجهزة", subscriptions: "الاشتراكات",
  customers: "العملاء", profiles: "ملفات الأجهزة", reports: "سجل الحركة", system: "حالة النظام"
};

function formatDate(value?: number | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function roleLabel(role?: string) { return role === "ADMIN" ? "مدير النظام" : "عميل"; }
function statusText(value?: string) {
  const map: Record<string, string> = {
    ONLINE_GPS_FIX: "متصل · GPS", ONLINE_NO_GPS_FIX: "متصل · بدون إشارة GPS",
    OFFLINE: "غير متصل", PENDING: "قيد التهيئة", WAITING_FOR_DEVICE: "بانتظار الجهاز",
    ACTIVATED: "مفعّل", ACTIVE: "نشط", AWAITING_FIRST_CONNECTION: "بانتظار أول اتصال",
    EXPIRED: "منتهي", SUSPENDED: "موقوف", FAILED: "فشل", QUEUED: "في الانتظار",
    MONTH_1: "شهر واحد", MONTH_3: "3 أشهر", MONTH_6: "6 أشهر", MONTH_12: "12 شهرًا", LIFETIME: "مدى الحياة",
    ACCEPTED: "مقبول", SENT: "تم الإرسال", DELIVERED: "تم التسليم", REPLIED: "تم الرد"
  };
  return map[value ?? ""] ?? value ?? "غير محدد";
}
function isOnline(device: DeviceBundle["device"]) {
  return (device.connectionState ?? "").startsWith("ONLINE");
}
function subscriptionLabel(bundle: DeviceBundle) {
  return statusText(bundle.subscription?.status ?? "—");
}

function Pill({ value, good = false }: { value: string; good?: boolean }) {
  const positive = good || ["ACTIVE", "ONLINE_GPS_FIX", "ONLINE_NO_GPS_FIX", "ACTIVATED", "DELIVERED", "REPLIED"].includes(value);
  const negative = ["OFFLINE", "EXPIRED", "SUSPENDED", "FAILED"].includes(value);
  return <span className={"pill " + (positive ? "pill-good" : negative ? "pill-bad" : "pill-muted")}>{statusText(value)}</span>;
}

function Modal({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={"modal " + (wide ? "modal-wide" : "")}>
        <header className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="إغلاق"><X size={18} /></button></header>
        {children}
      </section>
    </div>
  );
}

function PageTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-title"><div><span className="eyebrow">VELOTRACK / CONTROL CENTER</span><h1>{title}</h1></div>{action}</div>;
}
function Metric({ label, value, hint, icon: Icon, tone }: {
  label: string; value: string | number; hint: string; icon: typeof Activity; tone: string;
}) {
  return <div className="metric-card"><div className={"metric-icon " + tone}><Icon size={19} /></div><div className="metric-value">{value}</div><div className="metric-label">{label}</div><div className="metric-hint">{hint}</div></div>;
}
function Empty({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Boxes size={24} /></div><strong>{title}</strong>{action}</div>;
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const s = await api.login(identifier, password); saveSession(s); onLogin(s); }
    catch (err) { setError(err instanceof Error ? err.message : "تعذر تسجيل الدخول"); }
    finally { setBusy(false); }
  }
  return (
    <main className="auth-screen">
      <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      <section className="auth-card">
        <div className="brand-mark"><Gauge size={25} /></div>
        <div className="brand-name">VELO<span>TRACK</span></div>
        <h1>تسجيل الدخول</h1>
        <form onSubmit={submit} className="form-stack">
          <label>اسم المستخدم أو البريد الإلكتروني<input autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required /></label>
          <label>كلمة المرور<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="form-error"><AlertTriangle size={16} />{error}</div>}
          <button className="primary-btn full-btn" disabled={busy}>{busy ? "جارٍ التحقق..." : "دخول"}</button>
        </form>
        
      </section>
    </main>
  );
}

function PasswordChange({ session, onDone, onLogout }: {
  session: Session; onDone: (s: Session) => void; onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    if (next !== repeat) { setError("كلمتا المرور غير متطابقتين"); return; }
    setBusy(true);
    try { const s = await api.changePassword(session.token, current, next); saveSession(s); onDone(s); }
    catch (err) { setError(err instanceof Error ? err.message : "تعذر تغيير كلمة المرور"); }
    finally { setBusy(false); }
  }
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand-mark"><ShieldCheck size={25} /></div>
        <div className="brand-name">VELO<span>TRACK</span></div>
        <h1>تغيير كلمة المرور</h1>
        <form className="form-stack" onSubmit={submit}>
          <label>كلمة المرور الحالية<input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
          <label>كلمة المرور الجديدة<input type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
          <label>تأكيد كلمة المرور<input type="password" minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-btn full-btn" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}</button>
          <button type="button" className="text-btn" onClick={onLogout}>تسجيل الخروج</button>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [user, setUser] = useState<User | null>(session?.user ?? null);
  const [page, setPage] = useState<Page>("overview");
  const [devices, setDevices] = useState<DeviceBundle[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState("");
  const [socketLive, setSocketLive] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<DeviceBundle | null>(null);
  const [routeDeviceId, setRouteDeviceId] = useState("");
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeFrom, setRouteFrom] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 16));
  const [routeTo, setRouteTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [modal, setModal] = useState<"customer" | "device" | "profile" | "renew" | "reassign" | "override" | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = user?.role === "ADMIN";
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const logout = useCallback(() => {
    saveSession(null); setSession(null); setUser(null); setDevices([]); setUsers([]); setProfiles([]);
    setSelectedDevice(null); setSocketLive(false); setPage("overview");
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.token) return;
    setBusy(true); setPageError("");
    try {
      const tasks: Promise<any>[] = [api.devices(session.token), api.profiles(session.token)];
      if (session.user.role === "ADMIN") tasks.push(api.users(session.token));
      const result = await Promise.allSettled(tasks);
      if (result[0].status === "fulfilled") setDevices(result[0].value);
      else throw result[0].reason;
      if (result[1].status === "fulfilled") setProfiles(result[1].value);
      if (session.user.role === "ADMIN" && result[2]?.status === "fulfilled") setUsers(result[2].value);
      const h = await api.health().catch(() => null);
      if (h) setHealth(h);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تحميل البيانات");
    } finally { setBusy(false); }
  }, [session?.token, session?.user.role]);

  useEffect(() => {
    if (!session?.token) return;
    let active = true;
    (async () => {
      try {
        const freshUser = await api.me(session.token);
        if (!active) return;
        setUser(freshUser);
        setSession((old) => { if (!old) return old; const next = { ...old, user: freshUser }; saveSession(next); return next; });
        await refresh();
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("PASSWORD_CHANGE_REQUIRED")) {
          setSession((old) => old ? { ...old, mustChangePassword: true } : old);
        } else if (msg.includes("انتهت الجلسة") || msg.includes("AUTH_")) logout();
        else setPageError(msg);
      }
    })();
    return () => { active = false; };
  }, [session?.token, refresh, logout]);

  useEffect(() => {
    if (!session?.token || session.mustChangePassword || user?.mustChangePassword) return;
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let attempts = 0;
    const connect = () => {
      if (!active) return;
      try {
        socket = new WebSocket(liveSocketUrl(session.token));
        socket.onopen = () => { attempts = 0; setSocketLive(true); };
        socket.onmessage = (event) => {
          try {
            const frame = JSON.parse(String(event.data));
            if (frame.type === "SNAPSHOT" && Array.isArray(frame.devices)) setDevices(frame.devices);
            if (frame.type === "DEVICE_UPDATE" && Array.isArray(frame.devices)) {
              setDevices((prev) => {
                const byId = new Map(prev.map((x) => [x.device.id, x]));
                frame.devices.forEach((x: DeviceBundle) => byId.set(x.device.id, x));
                return Array.from(byId.values());
              });
            }
            if (frame.type === "ERROR") setPageError(String(frame.error ?? "WebSocket error"));
          } catch { /* ignore malformed live frame */ }
        };
        socket.onclose = () => {
          setSocketLive(false);
          if (active) {
            attempts += 1;
            retryTimer = window.setTimeout(connect, Math.min(30000, 1000 * (2 ** Math.min(attempts, 5))));
          }
        };
        socket.onerror = () => setSocketLive(false);
      } catch { setSocketLive(false); }
    };
    connect();
    return () => { active = false; window.clearTimeout(retryTimer); socket?.close(); };
  }, [session?.token, session?.mustChangePassword, user?.mustChangePassword]);

  useEffect(() => {
    if (!session?.token) return;
    const timer = window.setInterval(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, 30000);
    return () => window.clearInterval(timer);
  }, [session?.token]);

  const customerCount = users.filter((u) => u.role === "CUSTOMER" && u.isActive).length;
  const onlineCount = devices.filter((d) => isOnline(d.device)).length;
  const waitingCount = devices.filter((d) => d.subscription?.status === "AWAITING_FIRST_CONNECTION").length;
  const locatedCount = devices.filter((d) => d.device.hasValidFix && d.device.lastLat !== null && d.device.lastLng !== null).length;
  const filteredDevices = useMemo(() => devices.filter((x) => {
    const q = search.trim().toLowerCase();
    return !q || [x.device.vehicleName, x.device.plateNumber, x.device.imei, x.customer?.fullName]
      .some((v) => String(v ?? "").toLowerCase().includes(q));
  }), [devices, search]);

  async function runAction(action: () => Promise<unknown>, message: string) {
    if (!session) return;
    setBusy(true);
    try { await action(); await refresh(); notify(message); setModal(null); setSelectedDevice(null); }
    catch (err) { notify(err instanceof Error ? err.message : "تعذر تنفيذ العملية"); }
    finally { setBusy(false); }
  }

  async function submitCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!session) return;
    const f = new FormData(e.currentTarget);
    await runAction(() => api.createCustomer(session.token, {
      fullName: f.get("fullName"), username: f.get("username"), email: f.get("email"),
      phone: f.get("phone"), password: f.get("password")
    }), "تم إنشاء حساب العميل");
  }
  async function submitDevice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!session) return;
    const f = new FormData(e.currentTarget);
    await runAction(() => api.activateDevice(session.token, {
      profileId: f.get("profileId"), imei: f.get("imei"), customerId: f.get("customerId"),
      vehicleName: f.get("vehicleName"), plateNumber: f.get("plateNumber"),
      planDuration: f.get("planDuration"), simLocalWithoutPlus20: f.get("simLocalWithoutPlus20")
    }), "تم تسجيل الجهاز وإرسال طلب التهيئة");
  }
  async function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!session) return;
    const f = new FormData(e.currentTarget);
    await runAction(() => api.createProfile(session.token, {
      manufacturer: f.get("manufacturer"), model: f.get("model"), firmwareVersion: f.get("firmwareVersion"),
      serverHost: f.get("serverHost"), serverPort: Number(f.get("serverPort") || 5023),
      transport: "TCP", serverMode: "DOMAIN", requiresDevicePassword: false,
      requiresGprsonCommand: f.get("requiresGprsonCommand") === "on",
      serverCommandTemplate: f.get("serverCommandTemplate"),
      gprsonCommandTemplate: f.get("gprsonCommandTemplate") || null,
      isVerified: false
    }), "تم حفظ ملف الجهاز كغير معتمد");
  }
  async function submitDeviceAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!session || !selectedDevice) return;
    const f = new FormData(e.currentTarget);
    const id = selectedDevice.device.id;
    if (modal === "renew") await runAction(() => api.renew(session.token, id, String(f.get("planDuration"))), "تم تجديد الاشتراك");
    if (modal === "reassign") await runAction(() => api.reassign(session.token, id, String(f.get("customerId")), String(f.get("reason"))), "تم تغيير ملكية الجهاز");
    if (modal === "override") await runAction(() => api.overrideActivation(session.token, id, String(f.get("reason"))), "تم تسجيل التفعيل الإداري");
  }
  async function loadRoute(deviceId: string) {
    if (!session) return;
    setRouteDeviceId(deviceId); setRoutePoints([]);
    try {
      const points = await api.routeHistory(session.token, deviceId, new Date(routeFrom).toISOString(), new Date(routeTo).toISOString());
      setRoutePoints(points); setPage("reports");
    } catch (err) { notify(err instanceof Error ? err.message : "تعذر تحميل المسار"); }
  }

  if (!session) return <Login onLogin={(s) => { setSession(s); setUser(s.user); }} />;
  if (session.mustChangePassword || user?.mustChangePassword) {
    return <PasswordChange session={session} onDone={(s) => { setSession(s); setUser(s.user); notify("تم تحديث كلمة المرور"); }} onLogout={logout} />;
  }

  const nav: Array<{ id: Page; label: string; icon: typeof Activity; admin?: boolean }> = [
    { id: "overview" as Page, label: "نظرة عامة", icon: LayoutDashboard },
    { id: "live" as Page, label: "التتبع المباشر", icon: MapPinned },
    { id: "devices" as Page, label: "الأجهزة", icon: CarFront },
    { id: "subscriptions" as Page, label: "الاشتراكات", icon: CreditCard, admin: true },
    { id: "customers" as Page, label: "العملاء", icon: Users, admin: true },
    { id: "profiles" as Page, label: "ملفات الأجهزة", icon: Boxes, admin: true },
    { id: "reports" as Page, label: "سجل الحركة", icon: FileClock },
    { id: "system" as Page, label: "حالة النظام", icon: Settings2, admin: true }
  ].filter((x) => !x.admin || isAdmin);

  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebarOpen ? "sidebar-open" : "")}>
        <div className="sidebar-brand">
          <div className="brand-mark small"><Gauge size={20} /></div>
          <div><b>VELO<span>TRACK</span></b><small>FLEET MANAGEMENT</small></div>
          <button className="sidebar-close icon-btn" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <div className="sidebar-label">القائمة الرئيسية</div>
        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={"nav-link " + (page === item.id ? "active" : "")}
              onClick={() => { setPage(item.id); setSidebarOpen(false); }}>
              <Icon size={18} /><span>{item.label}</span>{item.id === "live" && socketLive && <i className="nav-live" />}
            </button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="server-mini"><span className={health?.supabaseConnected ? "status-dot good" : "status-dot bad"} />
            <div><b>{health?.supabaseConnected ? "قاعدة البيانات متصلة" : "قاعدة البيانات غير مؤكدة"}</b><small>{health?.traccarConnected ? "Traccar متصل" : "Traccar غير متصل"}</small></div>
          </div>
          <div className="user-mini">
            <div className="avatar">{(user?.fullName ?? "V").slice(0, 1)}</div>
            <div className="user-mini-info"><b>{user?.fullName ?? user?.username}</b><small>{roleLabel(user?.role)}</small></div>
            <button className="icon-btn" onClick={logout} aria-label="تسجيل الخروج"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      {sidebarOpen && <button className="mobile-shade" onClick={() => setSidebarOpen(false)} aria-label="إغلاق القائمة" />}
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start"><button className="menu-toggle icon-btn" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumb"><span>VeloTrack</span><b>/</b><strong>{pageNames[page]}</strong></div></div>
          <div className="topbar-actions">
            <span className={"connection-tag " + (socketLive ? "connected" : "")}><span className="status-dot" />{socketLive ? "مباشر" : "غير مباشر"}</span>
            <button className="icon-btn" onClick={() => refresh()} aria-label="تحديث"><RefreshCw size={18} /></button>
            <button className="icon-btn notification-btn" aria-label="الإشعارات"><Bell size={18} /><i /></button>
            <div className="top-avatar">{(user?.fullName ?? "V").slice(0, 1)}</div>
          </div>
        </header>
        <div className="content-area">
          {pageError && <div className="alert-banner"><AlertTriangle size={17} />{pageError}<button onClick={() => setPageError("")}><X size={16} /></button></div>}
          {page === "overview" && (
            <>
              <PageTitle title="نظرة عامة" action={<button className="secondary-btn" onClick={() => refresh()}><RefreshCw size={16} /> تحديث البيانات</button>} />
              <div className="welcome-strip"><div><span className="eyebrow">مرحبًا، {user?.fullName ?? user?.username}</span><h2>مركز إدارة الأسطول</h2></div><div className="welcome-art"><Gauge size={72} strokeWidth={1.1} /><span>LIVE DATA</span></div></div>
              <div className="metrics-grid">
                <Metric label="إجمالي الأجهزة" value={devices.length} hint="كل الأجهزة المسجلة" icon={CarFront} tone="tone-blue" />
                <Metric label="الأجهزة المتصلة" value={onlineCount} hint={devices.length ? Math.round(onlineCount / devices.length * 100) + "% من الأجهزة" : "لا توجد أجهزة"} icon={Wifi} tone="tone-green" />
                <Metric label="العملاء النشطون" value={isAdmin ? customerCount : "—"} hint="حسابات العملاء" icon={Users} tone="tone-gold" />
                <Metric label="بانتظار أول اتصال" value={waitingCount} hint="لم يبدأ الاشتراك بعد" icon={Clock3} tone="tone-violet" />
              </div>
              <div className="dashboard-grid">
                <section className="panel map-preview"><div className="panel-head"><div><h3>مواقع الأسطول</h3><small>{locatedCount} موقع حقيقي مستلم</small></div><button className="text-btn" onClick={() => setPage("live")}>عرض الخريطة <ArrowDownLeft size={15} /></button></div><MapPanel devices={devices} /></section>
                <section className="panel status-panel"><div className="panel-head"><h3>حالة الاتصال</h3><Signal size={18} /></div>
                  <div className="status-count"><div className="status-total">{devices.length}</div><span>جهاز</span></div>
                  <div className="status-bar"><i style={{ width: devices.length ? (onlineCount / devices.length * 100) + "%" : "0%" }} /></div>
                  <div className="legend-row"><span><i className="legend-dot online" />متصل</span><b>{onlineCount}</b></div>
                  <div className="legend-row"><span><i className="legend-dot offline" />غير متصل</span><b>{devices.length - onlineCount}</b></div>
                  <div className="legend-row"><span><i className="legend-dot waiting" />بانتظار الاتصال</span><b>{waitingCount}</b></div>
                  <div className="system-state"><div className="system-state-line"><Database size={16} />قاعدة البيانات<span className={health?.supabaseConnected ? "state-ok" : "state-warn"}>{health?.supabaseConnected ? "متصلة" : "غير مؤكدة"}</span></div><div className="system-state-line"><Globe2 size={16} />Traccar<span className={health?.traccarConnected ? "state-ok" : "state-warn"}>{health?.traccarConnected ? "متصل" : "غير متصل"}</span></div></div>
                </section>
              </div>
              <section className="panel table-panel"><div className="panel-head"><div><h3>أحدث الأجهزة</h3></div><button className="text-btn" onClick={() => setPage("devices")}>كل الأجهزة <ArrowDownLeft size={15} /></button></div>
                {devices.length ? <DeviceTable data={devices.slice(0, 6)} onOpen={setSelectedDevice} /> : <Empty title="لا توجد أجهزة مسجلة" action={isAdmin ? <button className="text-btn" onClick={() => setModal("device")}>إضافة أول جهاز <Plus size={15} /></button> : undefined} />}
              </section>
            </>
          )}

          {page === "live" && <><PageTitle title="التتبع المباشر" action={<span className={"connection-tag " + (socketLive ? "connected" : "")}><span className="status-dot" />{socketLive ? "اتصال مباشر" : "إعادة الاتصال..."}</span>} /><div className="live-layout"><div className="panel live-map"><div className="panel-head"><h3>خريطة المركبات</h3><span className="map-counter"><i className="live-dot" />{locatedCount} موقع</span></div><MapPanel devices={devices} selectedId={selectedDevice?.device.id} /></div><div className="panel live-list"><div className="panel-head"><h3>الأجهزة</h3><span>{devices.length}</span></div>{devices.length ? devices.map((x) => <button className={"live-device " + (selectedDevice?.device.id === x.device.id ? "selected" : "")} key={x.device.id} onClick={() => setSelectedDevice(x)}><span className={"vehicle-icon " + (isOnline(x.device) ? "online" : "")}><CarFront size={18} /></span><span className="live-device-name"><b>{x.device.vehicleName}</b><small>{x.device.plateNumber || x.device.imei}</small></span><Pill value={x.device.connectionState} /></button>) : <Empty title="لا توجد أجهزة" />}</div></div></>}

          {page === "devices" && <><PageTitle title="الأجهزة" action={isAdmin ? <button className="primary-btn" onClick={() => setModal("device")}><Plus size={17} /> إضافة جهاز</button> : undefined} /><section className="panel table-panel"><div className="toolbar"><div className="search-box"><Search size={17} /><input placeholder="بحث بالاسم أو اللوحة أو IMEI" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="toolbar-right"><span className="muted-label">{filteredDevices.length} جهاز</span><button className="icon-btn" onClick={() => refresh()}><Filter size={17} /></button></div></div>{filteredDevices.length ? <DeviceTable data={filteredDevices} onOpen={setSelectedDevice} /> : <Empty title="لا توجد نتائج" action={isAdmin && !devices.length ? <button className="text-btn" onClick={() => setModal("device")}>إضافة جهاز <Plus size={15} /></button> : undefined} />}</section></>}

          {page === "subscriptions" && <><PageTitle title="الاشتراكات" action={<span className="muted-label">{devices.filter((d) => d.subscription).length} اشتراك</span>} /><div className="metrics-grid compact-metrics"><Metric label="نشط" value={devices.filter((d) => d.subscription?.status === "ACTIVE").length} hint="" icon={CreditCard} tone="tone-green" /><Metric label="بانتظار الاتصال" value={waitingCount} hint="" icon={Clock3} tone="tone-gold" /><Metric label="منتهي" value={devices.filter((d) => d.subscription?.status === "EXPIRED").length} hint="" icon={AlertTriangle} tone="tone-violet" /></div><section className="panel table-panel"><div className="panel-head"><h3>قائمة الاشتراكات</h3><span className="muted-label">بيانات الخادم</span></div><div className="data-table-wrap"><table><thead><tr><th>الجهاز</th><th>العميل</th><th>الخطة</th><th>الحالة</th><th>تاريخ البداية</th><th>تاريخ الانتهاء</th><th>الإجراء</th></tr></thead><tbody>{devices.filter((d) => d.subscription).map((bundle) => <tr key={bundle.device.id}><td><div className="table-person"><span className="vehicle-icon"><CarFront size={17} /></span><div><b>{bundle.device.vehicleName}</b><small>{bundle.device.plateNumber || bundle.device.imei}</small></div></div></td><td>{bundle.customer?.fullName ?? "—"}</td><td>{statusText(bundle.subscription?.planDuration)}</td><td><Pill value={bundle.subscription?.status ?? "—"} /></td><td>{formatDate(bundle.subscription?.startedAtMs)}</td><td>{bundle.subscription?.planDuration === "LIFETIME" ? "مدى الحياة" : formatDate(bundle.subscription?.expiresAtMs)}</td><td><div className="row-actions"><button className="icon-btn" aria-label="تفاصيل الجهاز" onClick={() => { setSelectedDevice(bundle); setModal(null); }}><MoreHorizontal size={17} /></button><button className="icon-btn" aria-label="تجديد الاشتراك" onClick={() => { setSelectedDevice(bundle); setModal("renew"); }}><RefreshCw size={16} /></button></div></td></tr>)}</tbody></table></div>{!devices.some((d) => d.subscription) && <Empty title="لا توجد اشتراكات" />}</section></>}

          {page === "customers" && <><PageTitle title="العملاء" action={<button className="primary-btn" onClick={() => setModal("customer")}><Plus size={17} /> إضافة عميل</button>} /><div className="metrics-grid compact-metrics"><Metric label="إجمالي العملاء" value={customerCount} hint="حساب نشط" icon={Users} tone="tone-blue" /><Metric label="الأجهزة المسندة" value={devices.length} hint="إجمالي الأجهزة" icon={CarFront} tone="tone-green" /><Metric label="بانتظار الاتصال" value={waitingCount} hint="اشتراكات لم تبدأ" icon={Clock3} tone="tone-gold" /></div><section className="panel table-panel"><div className="panel-head"><h3>قائمة العملاء</h3><span className="muted-label">{customerCount} عميل</span></div><div className="data-table-wrap"><table><thead><tr><th>العميل</th><th>البريد الإلكتروني</th><th>الهاتف</th><th>الأجهزة</th><th>الحالة</th><th>تاريخ الإنشاء</th></tr></thead><tbody>{users.filter((u) => u.role === "CUSTOMER").map((u) => <tr key={u.id}><td><div className="table-person"><span className="avatar">{u.fullName.slice(0,1)}</span><b>{u.fullName}</b></div></td><td>{u.email}</td><td dir="ltr">{u.phone || "—"}</td><td>{devices.filter((d) => d.device.currentCustomerId === u.id).length}</td><td><Pill value={u.isActive ? "ACTIVE" : "SUSPENDED"} /></td><td>{formatDate(u.createdAtMs)}</td></tr>)}</tbody></table></div>{!users.filter((u) => u.role === "CUSTOMER").length && <Empty title="لا يوجد عملاء مسجلون" action={<button className="text-btn" onClick={() => setModal("customer")}>إضافة عميل <Plus size={15} /></button>} />}</section></>}

          {page === "profiles" && <><PageTitle title="ملفات الأجهزة" action={<button className="primary-btn" onClick={() => setModal("profile")}><Plus size={17} /> ملف جديد</button>} /><section className="profiles-grid">{profiles.map((p) => <article className="panel profile-card" key={p.id}><div className="profile-card-top"><div className="profile-symbol"><Smartphone size={22} /></div><Pill value={p.isVerified ? "ACTIVE" : "PENDING"} /></div><h3>{p.manufacturer} {p.model}</h3><p className="profile-firmware">{p.firmwareVersion} · {p.traccarProtocol}</p><div className="profile-data"><span>الخادم</span><b>{p.serverHost}:{p.serverPort}</b><span>النقل</span><b>{p.transport}</b></div><div className="profile-command"><small>SERVER COMMAND</small><code>{p.serverCommandTemplate}</code></div>{!p.isVerified && <button className="secondary-btn full-btn" onClick={() => { if (window.confirm("هل تم اختبار هذا الملف فعليًا على الجهاز والـ Firmware المحدد؟")) runAction(() => api.verifyProfile(session.token, p.id), "تم اعتماد الملف بعد الاختبار"); }}><ShieldCheck size={16} /> اعتماد بعد الاختبار الفعلي</button>}</article>)}{!profiles.length && <div className="panel profile-empty"><Empty title="لا توجد ملفات أجهزة" action={<button className="text-btn" onClick={() => setModal("profile")}>إضافة ملف <Plus size={15} /></button>} /></div>}</section></>}

          {page === "reports" && <><PageTitle title="سجل الحركة" action={<span className="muted-label">بيانات من Traccar</span>} /><section className="panel reports-panel"><div className="report-filters"><label>الجهاز<select value={routeDeviceId} onChange={(e) => setRouteDeviceId(e.target.value)}><option value="">اختر جهازًا</option>{devices.map((d) => <option key={d.device.id} value={d.device.id}>{d.device.vehicleName} · {d.device.imei}</option>)}</select></label><label>من<input type="datetime-local" value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)} /></label><label>إلى<input type="datetime-local" value={routeTo} onChange={(e) => setRouteTo(e.target.value)} /></label><button className="primary-btn" disabled={!routeDeviceId || busy} onClick={() => loadRoute(routeDeviceId)}><Search size={16} /> عرض المسار</button></div>{routePoints.length ? <><div className="route-summary"><b>{routePoints.length}</b><span>نقطة مسار</span><span>أول تسجيل: {formatDate(routePoints[0]?.recordedAtMs)}</span><span>آخر تسجيل: {formatDate(routePoints[routePoints.length - 1]?.recordedAtMs)}</span></div><MapPanel devices={devices} route={routePoints} /></> : <Empty title="اختر جهازًا وفترة زمنية لعرض المسار" />}</section></>}

          {page === "system" && <><PageTitle title="حالة النظام" action={<button className="secondary-btn" onClick={() => api.health().then(setHealth).catch(() => setHealth(null))}><RefreshCw size={16} /> فحص الآن</button>} /><div className="system-grid"><SystemCard icon={Database} title="Supabase / PostgreSQL" ok={!!health?.supabaseConnected} state={health?.supabaseConnected ? "اتصال قاعدة البيانات مؤكد" : "الاتصال غير متاح أو غير مؤكد"} /><SystemCard icon={Globe2} title="Traccar API" ok={!!health?.traccarConnected} state={health?.traccarConnected ? "جلسة Traccar نشطة" : "لا توجد جلسة Traccar نشطة"} /><SystemCard icon={Activity} title="Traccar WebSocket" ok={!!health?.traccarWsConnected} state={health?.traccarWsConnected ? "اتصال مباشر" : "غير متصل"} /><SystemCard icon={Signal} title="Live WebSocket" ok={socketLive} state={socketLive ? "واجهة الويب تستقبل التحديثات" : "واجهة الويب غير متصلة"} /><SystemCard icon={Smartphone} title="SMS Gateway" ok={!!health?.smsGatewayConfigured} state={health?.smsGatewayConfigured ? "مهيأ" : "غير مهيأ"} /><SystemCard icon={ShieldCheck} title="جلسة المستخدم" ok state={roleLabel(user?.role) + " · " + (user?.email ?? "")} /></div><div className="panel system-foot"><div><b>آخر مزامنة Traccar</b><span>{formatDate(health?.traccarLastSyncAtMs)}</span></div><div><b>API</b><span dir="ltr">{API_BASE || "غير مضبوط"}</span></div>{health?.databaseError && <div><b>Database error</b><code>{health.databaseError}</code></div>}{isAdmin && <button className="primary-btn" onClick={() => runAction(() => api.syncTraccar(session.token), "اكتملت مزامنة Traccar")}><RefreshCw size={16} /> مزامنة Traccar الآن</button>}</div></>}
        </div>
      </main>

      {selectedDevice && !modal && <Modal title={selectedDevice.device.vehicleName} onClose={() => setSelectedDevice(null)} wide>
        <div className="device-detail">
          <div className="detail-top"><div className="detail-vehicle"><div className="vehicle-icon online"><CarFront size={25} /></div><div><h2>{selectedDevice.device.vehicleName}</h2><span>{selectedDevice.device.plateNumber} · {selectedDevice.device.imei}</span></div></div><Pill value={selectedDevice.device.connectionState} /></div>
          <div className="detail-stats"><div><small>السرعة</small><b>{selectedDevice.device.lastSpeedKmh ?? "—"} <i>كم/س</i></b></div><div><small>الاشتراك</small><b>{subscriptionLabel(selectedDevice)}</b></div><div><small>آخر ظهور</small><b>{formatDate(selectedDevice.device.lastSeenAtMs)}</b></div><div><small>العميل</small><b>{selectedDevice.customer?.fullName ?? "—"}</b></div></div>
          <div className="detail-coords"><span>LAT <b>{selectedDevice.device.lastLat ?? "—"}</b></span><span>LNG <b>{selectedDevice.device.lastLng ?? "—"}</b></span><span>IMEI <b>{selectedDevice.device.imei}</b></span></div>
          <div className="detail-actions"><button className="secondary-btn" onClick={() => { setRouteDeviceId(selectedDevice.device.id); setModal(null); setSelectedDevice(null); setPage("reports"); }}>سجل الحركة <FileClock size={16} /></button>{isAdmin && <><button className="secondary-btn" onClick={() => setModal("renew")}>تجديد الاشتراك <RefreshCw size={16} /></button><button className="secondary-btn" onClick={() => setModal("reassign")}>نقل الملكية <Users size={16} /></button><button className="secondary-btn" onClick={() => setModal("override")}>تفعيل إداري <ShieldCheck size={16} /></button></>}</div>
          <div className="detail-audit"><h4>سجل رسائل التهيئة</h4>{selectedDevice.smsLogs?.length ? selectedDevice.smsLogs.map((log) => <div className="audit-line" key={log.id}><span>{log.commandKey}</span><code>{log.commandText}</code><Pill value={log.status} /></div>) : <span className="muted-label">لا توجد سجلات رسائل</span>}</div>
        </div>
      </Modal>}

      {modal === "customer" && <Modal title="إضافة عميل" onClose={() => setModal(null)}><form className="form-stack modal-form" onSubmit={submitCustomer}><label>الاسم الكامل<input name="fullName" required /></label><label>اسم المستخدم<input name="username" required /></label><label>البريد الإلكتروني<input name="email" type="email" required /></label><label>رقم الهاتف<input name="phone" type="tel" /></label><label>كلمة المرور<input name="password" type="password" minLength={8} required /></label><button className="primary-btn full-btn" disabled={busy}>إنشاء العميل</button></form></Modal>}

      {modal === "device" && <Modal title="إضافة جهاز GPS" onClose={() => setModal(null)} wide><form className="form-grid modal-form" onSubmit={submitDevice}><label>اسم المركبة<input name="vehicleName" required /></label><label>رقم اللوحة<input name="plateNumber" required /></label><label>IMEI<input name="imei" inputMode="numeric" minLength={15} maxLength={17} required /></label><label>رقم الشريحة بدون +20<input name="simLocalWithoutPlus20" inputMode="numeric" required /></label><label>العميل<select name="customerId" required defaultValue=""><option value="" disabled>اختر العميل</option>{users.filter((x) => x.role === "CUSTOMER" && x.isActive).map((x) => <option value={x.id} key={x.id}>{x.fullName}</option>)}</select></label><label>ملف الجهاز<select name="profileId" required defaultValue=""><option value="" disabled>اختر ملفًا معتمدًا</option>{profiles.filter((x) => x.isVerified).map((x) => <option value={x.id} key={x.id}>{x.manufacturer} {x.model} · {x.firmwareVersion}</option>)}</select></label><label>مدة الاشتراك<select name="planDuration"><option value="MONTH_1">شهر واحد</option><option value="MONTH_3">3 أشهر</option><option value="MONTH_6">6 أشهر</option><option value="MONTH_12">12 شهرًا</option><option value="LIFETIME">مدى الحياة</option></select></label><button className="primary-btn full-btn grid-full" disabled={busy || !profiles.some((x) => x.isVerified) || !users.some((x) => x.role === "CUSTOMER" && x.isActive)}>تسجيل الجهاز</button></form></Modal>}

      {modal === "profile" && <Modal title="ملف جهاز جديد" onClose={() => setModal(null)} wide><form className="form-grid modal-form" onSubmit={submitProfile}><label>الشركة المصنعة<input name="manufacturer" defaultValue="Concox" required /></label><label>الموديل<input name="model" defaultValue="GT06N" required /></label><label>إصدار Firmware<input name="firmwareVersion" required /></label><label>عنوان الخادم<input name="serverHost" required /></label><label>منفذ TCP<input name="serverPort" type="number" defaultValue="5023" required /></label><label>أمر SERVER<input name="serverCommandTemplate" placeholder="SERVER,1,host,5023,0#" required /></label><label className="checkbox-line"><input type="checkbox" name="requiresGprsonCommand" /> يتطلب GPRSON</label><label>أمر GPRSON<input name="gprsonCommandTemplate" defaultValue="GPRSON,1#" /></label><button className="primary-btn full-btn grid-full" disabled={busy}>حفظ الملف</button></form></Modal>}

      {["renew", "reassign", "override"].includes(modal ?? "") && selectedDevice && <Modal title={modal === "renew" ? "تجديد الاشتراك" : modal === "reassign" ? "نقل ملكية الجهاز" : "تفعيل إداري"} onClose={() => setModal(null)}><form className="form-stack modal-form" onSubmit={submitDeviceAction}>
        {modal === "renew" && <label>مدة الاشتراك الجديدة<select name="planDuration"><option value="MONTH_1">شهر واحد</option><option value="MONTH_3">3 أشهر</option><option value="MONTH_6">6 أشهر</option><option value="MONTH_12">12 شهرًا</option><option value="LIFETIME">مدى الحياة</option></select></label>}
        {modal === "reassign" && <><label>العميل الجديد<select name="customerId" required>{users.filter((u) => u.role === "CUSTOMER" && u.isActive).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select></label><label>سبب النقل<input name="reason" required /></label></>}
        {modal === "override" && <label>سبب التفعيل الإداري<input name="reason" required /></label>}
        <button className="primary-btn full-btn" disabled={busy}>تأكيد العملية</button>
      </form></Modal>}

      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function DeviceTable({ data, onOpen }: { data: DeviceBundle[]; onOpen: (x: DeviceBundle) => void }) {
  return <div className="data-table-wrap"><table><thead><tr><th>المركبة</th><th>IMEI</th><th>العميل</th><th>الاتصال</th><th>الاشتراك</th><th>آخر ظهور</th><th /></tr></thead><tbody>{data.map((x) => <tr key={x.device.id} onClick={() => onOpen(x)} className="click-row"><td><div className="table-person"><span className="vehicle-icon"><CarFront size={17} /></span><div><b>{x.device.vehicleName}</b><small>{x.device.plateNumber || "بدون لوحة"}</small></div></div></td><td dir="ltr">{x.device.imei}</td><td>{x.customer?.fullName ?? "—"}</td><td><Pill value={x.device.connectionState} /></td><td><Pill value={x.subscription?.status ?? "—"} /></td><td>{formatDate(x.device.lastSeenAtMs)}</td><td><button className="icon-btn" onClick={(e) => { e.stopPropagation(); onOpen(x); }}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>;
}
function SystemCard({ icon: Icon, title, ok, state }: { icon: typeof Activity; title: string; ok: boolean; state: string }) {
  return <div className="panel system-card"><div className={"system-card-icon " + (ok ? "good" : "bad")}><Icon size={20} /></div><div><b>{title}</b><small>{state}</small></div><span className={"status-dot " + (ok ? "good" : "bad")} /></div>;
}
