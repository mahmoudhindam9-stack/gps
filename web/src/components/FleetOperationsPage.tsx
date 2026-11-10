import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, Bell, Copy, FileBarChart, MapPinned, Plus, RefreshCw, Share2, Trash2, Waves } from "lucide-react";
import { api } from "../api";
import type { DeviceBundle, FleetEvent, FleetGeofence, FleetMileageSummary, FleetTelemetry } from "../types";

type Tab = "alerts" | "geofences" | "telemetry" | "mileage" | "sharing";
interface Props { token: string; devices: DeviceBundle[]; isAdmin: boolean; onNotify: (message: string) => void; }
const tabItems: Array<{ id: Tab; label: string; icon: typeof Bell }> = [
  { id: "alerts", label: "مركز التنبيهات", icon: Bell },
  { id: "geofences", label: "المناطق الجغرافية", icon: MapPinned },
  { id: "telemetry", label: "بيانات الحساسات", icon: Activity },
  { id: "mileage", label: "تقارير المسافة", icon: FileBarChart },
  { id: "sharing", label: "مشاركة الموقع", icon: Share2 }
];
const eventNames: Record<string, string> = {
  deviceOnline: "الجهاز اتصل", deviceOffline: "الجهاز غير متصل",
  deviceMoving: "بدأت الحركة", deviceStopped: "توقف",
  geofenceEnter: "دخول نطاق جغرافي", geofenceExit: "خروج من نطاق جغرافي",
  ignitionOn: "فتح الكونتاكت", ignitionOff: "إغلاق الكونتاكت",
  alarm: "إنذار", overspeed: "تجاوز السرعة", commandResult: "نتيجة أمر"
};
const sensorNames: Record<string, string> = {
  batteryLevel: "مستوى البطارية", battery: "البطارية", power: "مصدر الطاقة",
  externalPower: "الجهد الخارجي", externalVoltage: "الجهد الخارجي",
  fuel: "الوقود", fuelLevel: "مستوى الوقود", fuelPercentage: "نسبة الوقود",
  fuelConsumption: "استهلاك الوقود", odometer: "عداد المسافة", totalDistance: "المسافة الكلية",
  temperature: "درجة الحرارة", door: "الأبواب", ignition: "الكونتاكت", motion: "الحركة",
  alarm: "الإنذار", satellites: "عدد الأقمار", sat: "عدد الأقمار",
  rssi: "قوة الإشارة", gsmSignal: "إشارة الشبكة", charge: "الشحن",
  charging: "حالة الشحن", voltage: "الجهد", engineHours: "ساعات المحرك"
};
function dateInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function dateText(value?: string | number | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" :
    new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function valueText(value: string | number | boolean) {
  return typeof value === "boolean" ? (value ? "نعم" : "لا") : String(value);
}

export default function FleetOperationsPage({ token, devices, isAdmin, onNotify }: Props) {
  const [tab, setTab] = useState<Tab>("alerts");
  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 7 * 86400000)));
  const [to, setTo] = useState(() => dateInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [zones, setZones] = useState<FleetGeofence[]>([]);
  const [telemetry, setTelemetry] = useState<FleetTelemetry[]>([]);
  const [mileage, setMileage] = useState<FleetMileageSummary[]>([]);
  const [zoneName, setZoneName] = useState("");
  const [zoneDescription, setZoneDescription] = useState("");
  const [zoneArea, setZoneArea] = useState("");
  const [zoneDeviceId, setZoneDeviceId] = useState("");
  const [shareDeviceId, setShareDeviceId] = useState("");
  const [shareHours, setShareHours] = useState(24);
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpiry, setShareExpiry] = useState("");

  const availableDevices = useMemo(() => devices.filter((bundle) => {
    if (isAdmin) return true;
    return bundle.subscription?.status === "ACTIVE" &&
      (bundle.subscription.planDuration === "LIFETIME" ||
        (bundle.subscription.expiresAtMs ?? 0) > Date.now());
  }), [devices, isAdmin]);

  useEffect(() => {
    if (!deviceId && availableDevices.length) setDeviceId(availableDevices[0].device.id);
    if (!zoneDeviceId && availableDevices.length) setZoneDeviceId(availableDevices[0].device.id);
    if (!shareDeviceId && availableDevices.length) setShareDeviceId(availableDevices[0].device.id);
  }, [deviceId, zoneDeviceId, shareDeviceId, availableDevices]);

  const loadEvents = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const start = new Date(from), end = new Date(to);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw new Error("راجع تاريخ البداية والنهاية");
      }
      setEvents(await api.fleetEvents(token, start.toISOString(), end.toISOString(), deviceId || undefined));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل الأحداث");
    } finally { setLoading(false); }
  }, [token, from, to, deviceId]);

  const loadZones = useCallback(async () => {
    setLoading(true); setError("");
    try { setZones(await api.geofences(token)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل المناطق"); }
    finally { setLoading(false); }
  }, [token]);

  const loadTelemetry = useCallback(async () => {
    setLoading(true); setError("");
    try { setTelemetry(await api.fleetTelemetry(token, deviceId || undefined)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل الحساسات"); }
    finally { setLoading(false); }
  }, [token, deviceId]);

  const loadMileage = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const start = new Date(from), end = new Date(to);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
        throw new Error("راجع تاريخ البداية والنهاية");
      }
      setMileage(await api.mileageSummary(token, start.toISOString(), end.toISOString(), deviceId || undefined));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل التقرير");
    } finally { setLoading(false); }
  }, [token, from, to, deviceId]);

  useEffect(() => {
    if (tab === "alerts") void loadEvents();
    if (tab === "geofences") void loadZones();
    if (tab === "telemetry") void loadTelemetry();
  }, [tab, loadEvents, loadZones, loadTelemetry]);

  async function createZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      await api.createGeofence(token, {
        name: zoneName, description: zoneDescription, area: zoneArea, deviceIds: [zoneDeviceId]
      });
      setZoneName(""); setZoneDescription(""); setZoneArea("");
      await loadZones(); onNotify("تم إنشاء المنطقة وربطها بالمركبة");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء المنطقة");
    } finally { setLoading(false); }
  }

  async function deleteZone(id: number) {
    if (!window.confirm("هل تريد حذف هذه المنطقة الجغرافية؟")) return;
    setLoading(true); setError("");
    try { await api.deleteGeofence(token, id); await loadZones(); onNotify("تم حذف المنطقة"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حذف المنطقة"); }
    finally { setLoading(false); }
  }

  async function createShare() {
    if (!shareDeviceId) { setError("اختر المركبة أولًا"); return; }
    setLoading(true); setError(""); setShareUrl("");
    try {
      const result = await api.createDeviceShare(token, shareDeviceId, shareHours);
      setShareUrl(result.shareUrl); setShareExpiry(result.expiresAt);
      onNotify("تم إنشاء رابط مشاركة مؤقت");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء رابط المشاركة");
    } finally { setLoading(false); }
  }

  return (
    <section className="fleet-operations">
      <header className="fleet-operations-head">
        <div><span className="eyebrow">VELOTRACK / FLEET INTELLIGENCE</span><h1>مركز الأسطول</h1>
          <p>التنبيهات والمناطق الجغرافية والحساسات وتقارير المسافة ومشاركة الموقع.</p></div>
        <span className="fleet-scope-pill">{availableDevices.length} مركبة متاحة</span>
      </header>
      <div className="fleet-tabs" role="tablist" aria-label="أدوات الأسطول">
        {tabItems.map((item) => { const Icon = item.icon; return (
          <button type="button" role="tab" aria-selected={tab === item.id} key={item.id}
            className={"fleet-tab " + (tab === item.id ? "active" : "")}
            onClick={() => { setError(""); setTab(item.id); }}>
            <Icon size={16} />{item.label}
          </button>
        ); })}
      </div>
      {error && <div className="alert-banner fleet-error"><span>{error}</span>
        <button type="button" onClick={() => setError("")}>×</button></div>}

      {(tab === "alerts" || tab === "mileage" || tab === "telemetry") && (
        <div className="panel fleet-filter-panel">
          <label>المركبة<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            <option value="">كل المركبات المصرح بها</option>
            {availableDevices.map((bundle) => <option key={bundle.device.id} value={bundle.device.id}>
              {bundle.device.vehicleName} · {bundle.device.plateNumber || bundle.device.imei}
            </option>)}
          </select></label>
          {(tab === "alerts" || tab === "mileage") && <>
            <label>من<input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>إلى<input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </>}
          <button type="button" className="primary-btn" disabled={loading}
            onClick={() => { if (tab === "alerts") void loadEvents(); else if (tab === "mileage") void loadMileage(); else void loadTelemetry(); }}>
            <RefreshCw size={15} />{loading ? "جارٍ التحميل..." : "تحديث البيانات"}
          </button>
        </div>
      )}

      {tab === "alerts" && <section className="panel fleet-content-panel">
        <div className="panel-head"><div><h3>سجل التنبيهات والأحداث</h3><small>أحداث فعلية من Traccar للفترة المحددة</small></div>
          <span className="muted-label">{events.length} حدث</span></div>
        {!events.length ? <div className="fleet-empty"><Bell size={24} /><b>لا توجد أحداث معروضة</b>
          <span>حدد الفترة ثم حدّث البيانات</span></div> :
          <div className="data-table-wrap"><table><thead><tr><th>الحدث</th><th>المركبة</th><th>التاريخ</th><th>تفاصيل</th></tr></thead>
            <tbody>{events.map((event) => <tr key={event.id}>
              <td><span className="fleet-event-tag">{eventNames[event.type] ?? event.type}</span></td>
              <td>{event.vehicleName}</td><td>{dateText(event.eventTime)}</td>
              <td>{event.geofenceId ? "منطقة رقم " + event.geofenceId :
                event.attributes?.alarm ? String(event.attributes.alarm) : "—"}</td>
            </tr>)}</tbody></table></div>}
      </section>}

      {tab === "geofences" && <div className="fleet-module-grid">
        <section className="panel fleet-content-panel"><div className="panel-head">
          <div><h3>المناطق المرتبطة بالأسطول</h3><small>المناطق المسندة إلى مركبات حسابك فقط</small></div>
          <button type="button" className="icon-btn" onClick={() => void loadZones()} aria-label="تحديث"><RefreshCw size={16} /></button>
        </div>
        {!zones.length ? <div className="fleet-empty"><MapPinned size={24} /><b>لا توجد مناطق مرتبطة</b></div> :
          <div className="fleet-zone-list">{zones.map((zone) => <article className="fleet-zone-card" key={zone.id}>
            <div><b>{zone.name}</b><p>{zone.description || "بدون وصف"}</p>
              <small>{zone.vehicleNames.join("، ")}</small><code>{zone.area}</code></div>
            {isAdmin && <button type="button" className="icon-btn danger" onClick={() => void deleteZone(zone.id)} aria-label="حذف المنطقة"><Trash2 size={16} /></button>}
          </article>)}</div>}
        </section>
        {isAdmin && <section className="panel fleet-content-panel"><div className="panel-head">
          <div><h3>إضافة منطقة جديدة</h3><small>دائرة أو مضلع بصيغة WKT</small></div><Plus size={18} /></div>
          <form className="fleet-zone-form" onSubmit={createZone}>
            <label>اسم المنطقة<input value={zoneName} onChange={(event) => setZoneName(event.target.value)} maxLength={100} required /></label>
            <label>الوصف<input value={zoneDescription} onChange={(event) => setZoneDescription(event.target.value)} maxLength={500} /></label>
            <label>المركبة<select value={zoneDeviceId} onChange={(event) => setZoneDeviceId(event.target.value)} required>
              <option value="">اختر مركبة</option>{availableDevices.map((bundle) => <option key={bundle.device.id} value={bundle.device.id}>{bundle.device.vehicleName}</option>)}
            </select></label>
            <label>حدود المنطقة (WKT)<textarea value={zoneArea} onChange={(event) => setZoneArea(event.target.value)}
              placeholder={"CIRCLE (31.2357 30.0444, 250)"} rows={4} required /></label>
            <small className="fleet-form-hint">الدائرة: CIRCLE (خط الطول خط العرض، نصف القطر بالمتر). المضلع: POLYGON ((lon lat, lon lat, lon lat, lon lat)). أغلق المضلع بإعادة نقطة البداية.</small>
            <button className="primary-btn" type="submit" disabled={loading || !zoneDeviceId}><Plus size={15} />إنشاء وربط المنطقة</button>
          </form>
        </section>}
      </div>}

      {tab === "telemetry" && <section className="panel fleet-content-panel">
        <div className="panel-head"><div><h3>القراءات التي أرسلها الجهاز</h3><small>لا تظهر قيمة إلا إذا وصلت فعليًا من الجهاز</small></div><Waves size={18} /></div>
        {!telemetry.length ? <div className="fleet-empty"><Activity size={24} /><b>لا توجد بيانات حساسات</b>
          <span>قد لا يدعم الجهاز هذه الحساسات أو لم يرسلها بعد</span></div> :
          <div className="fleet-telemetry-list">{telemetry.map((item) => <article className="fleet-telemetry-card" key={item.deviceId}>
            <header><b>{item.vehicleName}</b><small>آخر قراءة: {dateText(item.reportedAtMs)}</small></header>
            {!Object.keys(item.values).length ? <p className="muted-label">لا توجد قراءات إضافية في آخر تحديث</p> :
              <div className="fleet-telemetry-grid">{Object.entries(item.values).map(([key, value]) =>
                <div key={key}><span>{sensorNames[key] ?? key}</span><b>{valueText(value)}</b></div>)}</div>}
          </article>)}</div>}
      </section>}

      {tab === "mileage" && <section className="panel fleet-content-panel">
        <div className="panel-head"><div><h3>ملخص المسافة والاستهلاك</h3><small>من تقارير Traccar للفترة المحددة</small></div><FileBarChart size={18} /></div>
        {!mileage.length ? <div className="fleet-empty"><FileBarChart size={24} /><b>لا يوجد تقرير معروض</b>
          <span>حدد الفترة ثم اضغط تحديث البيانات</span></div> :
          <div className="data-table-wrap"><table><thead><tr><th>المركبة</th><th>المسافة كم</th><th>متوسط السرعة</th><th>أقصى سرعة</th><th>الوقود لتر</th><th>ساعات المحرك</th></tr></thead>
            <tbody>{mileage.map((row) => <tr key={row.deviceId}><td>{row.vehicleName}</td><td>{row.distanceKm ?? "—"}</td>
              <td>{row.averageSpeedKmh ?? "—"} كم/س</td><td>{row.maxSpeedKmh ?? "—"} كم/س</td>
              <td>{row.spentFuelLiters ?? "—"}</td><td>{row.engineHours ?? "—"}</td></tr>)}</tbody></table></div>}
      </section>}

      {tab === "sharing" && <section className="panel fleet-content-panel fleet-sharing-panel">
        <div className="panel-head"><div><h3>مشاركة موقع المركبة</h3><small>رابط مؤقت ينتهي تلقائيًا في الموعد المحدد</small></div><Share2 size={18} /></div>
        <div className="fleet-share-form">
          <label>المركبة<select value={shareDeviceId} onChange={(event) => setShareDeviceId(event.target.value)}>
            <option value="">اختر مركبة</option>{availableDevices.map((bundle) => <option key={bundle.device.id} value={bundle.device.id}>{bundle.device.vehicleName}</option>)}
          </select></label>
          <label>مدة الرابط<select value={shareHours} onChange={(event) => setShareHours(Number(event.target.value))}>
            <option value={1}>ساعة واحدة</option><option value={6}>6 ساعات</option><option value={12}>12 ساعة</option>
            <option value={24}>24 ساعة</option><option value={72}>3 أيام</option><option value={168}>7 أيام</option>
          </select></label>
          <button type="button" className="primary-btn" onClick={() => void createShare()} disabled={loading || !shareDeviceId}><Share2 size={15} />إنشاء رابط مؤقت</button>
        </div>
        {shareUrl && <div className="fleet-share-result"><b>رابط المشاركة جاهز</b><code dir="ltr">{shareUrl}</code>
          <span>ينتهي في {dateText(shareExpiry)}</span>
          <button type="button" className="secondary-btn" onClick={() => {
            void navigator.clipboard?.writeText(shareUrl).then(
              () => onNotify("تم نسخ رابط المشاركة"),
              () => onNotify("انسخ الرابط يدويًا")
            );
          }}><Copy size={15} />نسخ الرابط</button>
        </div>}
        <p className="fleet-form-hint">يتطلب TRACCAR_PUBLIC_URL بعنوان HTTPS عام. لا يكشف عنوان Traccar الداخلي.</p>
      </section>}

      {loading && <div className="fleet-loading">جارٍ تنفيذ الطلب...</div>}
      {!availableDevices.length && <div className="fleet-empty fleet-global-empty"><Activity size={24} /><b>لا توجد مركبات متاحة</b>
        <span>تحقق من ملكية المركبة وحالة الاشتراك</span></div>}
      <footer className="fleet-page-foot">Traccar هو مصدر بيانات GPS، وVeloTrack يدير الحسابات والاشتراكات.</footer>
    </section>
  );
}
