import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  Bell,
  Boxes,
  Camera,
  CarFront,
  Check,
  Clock3,
  CreditCard,
  Database,
  Edit3,
  Eye,
  FileClock,
  Filter,
  Gauge,
  Globe2,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Menu,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
  Plus,
  Power,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Signal,
  Smartphone,
  Terminal,
  Trash2,
  Users,
  Wifi,
  X
} from "lucide-react";
import { api, API_BASE, APP_VERSION, GITHUB_REPO, liveSocketUrl, readSession, saveSession } from "./api";
import type {
  CustomerDetails,
  DeviceBundle,
  DeviceCommandType,
  DeviceProfile,
  GitHubReleaseInfo,
  Health,
  Page,
  RoutePoint,
  Session,
  User,
  VehicleIcon,
  VehicleType
} from "./types";
import MapPanel, { getVehicleSvgMarkup, VEHICLE_ICON_OPTIONS } from "./components/MapPanel";
import BarcodeScannerModal, { isValidImei15 } from "./components/BarcodeScannerModal";
import FleetOperationsPage from "./components/FleetOperationsPage";

const pageNames: Record<Page, string> = {
  overview: "نظرة عامة",
  live: "التتبع المباشر",
  devices: "المركبات والأجهزة",
  subscriptions: "الاشتراكات",
  customers: "المستخدمون والعملاء",
  customer_details: "تفاصيل العميل",
  profiles: "ملفات الأجهزة",
  reports: "سجل الحركة",
  fleet_tools: "مركز الأسطول",
  system: "حالة النظام"
};

const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  CAR: "سيارة",
  MOTORCYCLE: "دراجة نارية",
  TRUCK: "شاحنة",
  BUS: "حافلة",
  VAN: "فان",
  EQUIPMENT: "معدات ثقيلة",
  OTHER: "أخرى"
};

function formatDate(value?: number | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value)
  );
}

function roleLabel(role?: string) {
  return role === "ADMIN" ? "مدير النظام" : "عميل";
}

function statusText(value?: string) {
  const map: Record<string, string> = {
    ONLINE_GPS_FIX: "متصل · GPS",
    ONLINE_NO_GPS_FIX: "متصل · بدون إشارة GPS",
    OFFLINE: "غير متصل",
    DRAFT: "مسجل · بانتظار إرسال التفعيل",
    SMS_QUEUED: "جاري إرسال الرسالة",
    SMS_SENT: "تم إرسال الرسالة",
    SMS_DELIVERED: "تم تسليم الرسالة",
    SMS_REPLIED: "رد الجهاز على الرسالة",
    SMS_FAILED: "فشل إرسال الرسالة",
    PENDING: "قيد التهيئة",
    WAITING_FOR_DEVICE: "بانتظار اتصال الجهاز",
    ACTIVATED: "مفعّل",
    ADMIN_OVERRIDDEN: "تفعيل إداري",
    ACTIVE: "نشط",
    AWAITING_FIRST_CONNECTION: "بانتظار أول اتصال",
    EXPIRED: "منتهي",
    SUSPENDED: "موقوف",
    FAILED: "فشل",
    QUEUED: "في الانتظار",
    MONTH_1: "شهر واحد",
    MONTH_3: "3 أشهر",
    MONTH_6: "6 أشهر",
    MONTH_12: "12 شهرًا",
    LIFETIME: "مدى الحياة",
    ACCEPTED: "مقبول",
    SENT: "تم الإرسال",
    DELIVERED: "تم التسليم",
    REPLIED: "تم الرد"
  };
  return map[value ?? ""] ?? value ?? "غير محدد";
}

function isOnline(device: DeviceBundle["device"]) {
  return (device.connectionState ?? "").startsWith("ONLINE");
}

function subscriptionLabel(bundle: DeviceBundle) {
  return statusText(bundle.subscription?.status ?? "—");
}

function VehicleSvgBadge({
  icon,
  online = false
}: {
  icon?: string;
  online?: boolean;
}) {
  return (
    <span
      className={"vehicle-icon " + (online ? "online" : "")}
      dangerouslySetInnerHTML={{
        __html: getVehicleSvgMarkup(icon, online ? "#64d4a9" : "#9fb3ce")
      }}
    />
  );
}

function Pill({ value, good = false }: { value: string; good?: boolean }) {
  const positive =
    good ||
    [
      "ACTIVE",
      "ONLINE_GPS_FIX",
      "ONLINE_NO_GPS_FIX",
      "ACTIVATED",
      "DELIVERED",
      "REPLIED",
      "SENT"
    ].includes(value);
  const negative = ["OFFLINE", "EXPIRED", "SUSPENDED", "FAILED", "SMS_FAILED"].includes(value);
  return (
    <span className={"pill " + (positive ? "pill-good" : negative ? "pill-bad" : "pill-muted")}>
      {statusText(value)}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className={"modal " + (wide ? "modal-wide" : "")}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function PageTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">VELOTRACK / CONTROL CENTER</span>
        <h1>{title}</h1>
      </div>
      <div className="page-title-actions">{action}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <div className="metric-card">
      <div className={"metric-icon " + tone}>
        <Icon size={19} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

function Empty({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Boxes size={24} />
      </div>
      <strong>{title}</strong>
      {action}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await api.login(identifier, password);
      saveSession(s);
      onLogin(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <div className="auth-orbit orbit-one" />
      <div className="auth-orbit orbit-two" />
      <section className="auth-card">
        <div className="brand-mark">
          <Gauge size={25} />
        </div>
        <div className="brand-name">
          VELO<span>TRACK</span>
        </div>
        <h1>تسجيل الدخول</h1>
        <form onSubmit={submit} className="form-stack">
          <label>
            اسم المستخدم أو رقم الهاتف
            <input
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </label>
          <label>
            كلمة المرور
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <div className="form-error">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
          <button className="primary-btn full-btn" disabled={busy}>
            {busy ? "جارٍ التحقق..." : "دخول"}
          </button>
        </form>
      </section>
    </main>
  );
}

function PasswordChange({
  session,
  onDone,
  onLogout
}: {
  session: Session;
  onDone: (s: Session) => void;
  onLogout: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (next !== repeat) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    setBusy(true);
    try {
      const s = await api.changePassword(session.token, current, next);
      saveSession(s);
      onDone(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تغيير كلمة المرور");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand-mark">
          <ShieldCheck size={25} />
        </div>
        <div className="brand-name">
          VELO<span>TRACK</span>
        </div>
        <h1>تغيير كلمة المرور</h1>
        <form className="form-stack" onSubmit={submit}>
          <label>
            كلمة المرور الحالية
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </label>
          <label>
            كلمة المرور الجديدة
            <input
              type="password"
              minLength={8}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </label>
          <label>
            تأكيد كلمة المرور
            <input
              type="password"
              minLength={8}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-btn full-btn" disabled={busy}>
            {busy ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}
          </button>
          <button type="button" className="text-btn" onClick={onLogout}>
            تسجيل الخروج
          </button>
        </form>
      </section>
    </main>
  );
}

type ModalKind =
  | "user_create"
  | "user_edit"
  | "device"
  | "vehicle_edit"
  | "profile"
  | "renew"
  | "reassign"
  | "override"
  | "suspend"
  | "resume"
  | "confirm_command"
  | null;

export default function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [user, setUser] = useState<User | null>(session?.user ?? null);
  const [page, setPage] = useState<Page>("overview");
  const [devices, setDevices] = useState<DeviceBundle[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [profiles, setProfiles] = useState<DeviceProfile[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [releaseInfo, setReleaseInfo] = useState<GitHubReleaseInfo | null>(null);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState("");
  const [socketLive, setSocketLive] = useState(false);
  const [search, setSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedDevice, setSelectedDevice] = useState<DeviceBundle | null>(null);
  const [selectedCustomerDetails, setSelectedCustomerDetails] = useState<CustomerDetails | null>(
    null
  );
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [preselectedCustomerId, setPreselectedCustomerId] = useState<string>("");

  // Add/Edit Vehicle form state
  const [formImei, setFormImei] = useState("");
  const [formSerialNumber, setFormSerialNumber] = useState("");
  const [formVehicleType, setFormVehicleType] = useState<VehicleType>("CAR");
  const [formVehicleIcon, setFormVehicleIcon] = useState<VehicleIcon>("car");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [smsSendingDeviceId, setSmsSendingDeviceId] = useState<string | null>(null);

  // Command control state
  const [pendingSensitiveCmd, setPendingSensitiveCmd] = useState<{
    deviceId: string;
    cmd: DeviceCommandType;
    parameters: Record<string, unknown>;
  } | null>(null);
  const [cmdParamText, setCmdParamText] = useState("");

  const [routeDeviceId, setRouteDeviceId] = useState("");
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeFrom, setRouteFrom] = useState(() =>
    new Date(Date.now() - 86400000).toISOString().slice(0, 16)
  );
  const [routeTo, setRouteTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [modal, setModal] = useState<ModalKind>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isAdmin = user?.role === "ADMIN";

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }, []);

  const logout = useCallback(() => {
    saveSession(null);
    setSession(null);
    setUser(null);
    setDevices([]);
    setUsers([]);
    setProfiles([]);
    setSelectedDevice(null);
    setSelectedCustomerDetails(null);
    setSocketLive(false);
    setPage("overview");
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.token) return;
    setBusy(true);
    setPageError("");
    try {
      const tasks: Promise<any>[] = [api.devices(session.token), api.profiles(session.token)];
      if (session.user.role === "ADMIN") tasks.push(api.users(session.token));
      const result = await Promise.allSettled(tasks);
      if (result[0].status === "fulfilled") {
        const list: DeviceBundle[] = result[0].value;
        setDevices(list);
      } else {
        throw result[0].reason;
      }
      if (result[1].status === "fulfilled") setProfiles(result[1].value);
      if (session.user.role === "ADMIN" && result[2]?.status === "fulfilled") {
        setUsers(result[2].value);
      }
      const h = await api.health().catch(() => null);
      if (h) setHealth(h);
      if (autoUpdateEnabled) {
        api.checkUpdate(true).then(setReleaseInfo).catch(() => null);
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "تعذر تحميل البيانات");
    } finally {
      setBusy(false);
    }
  }, [session?.token, session?.user.role, autoUpdateEnabled]);

  const openCustomerDetailsPage = useCallback(
    async (customerId: string) => {
      if (!session?.token) return;
      setBusy(true);
      try {
        const details = await api.customerDetails(session.token, customerId);
        setSelectedCustomerDetails(details);
        setPage("customer_details");
      } catch (err) {
        notify(err instanceof Error ? err.message : "تعذر تحميل تفاصيل العميل");
      } finally {
        setBusy(false);
      }
    },
    [session?.token, notify]
  );

  const openVehicleDetails = useCallback(
    async (bundle: DeviceBundle) => {
      setSelectedDevice(bundle);
      if (!session?.token) return;
      try {
        const full = await api.deviceDetails(session.token, bundle.device.id);
        setSelectedDevice(full);
      } catch {
        // fallback to current bundle if offline
      }
    },
    [session?.token]
  );

  useEffect(() => {
    if (!session?.token) return;
    let active = true;
    (async () => {
      try {
        const freshUser = await api.me(session.token);
        if (!active) return;
        setUser(freshUser);
        setSession((old) => {
          if (!old) return old;
          const next = { ...old, user: freshUser };
          saveSession(next);
          return next;
        });
        await refresh();
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("PASSWORD_CHANGE_REQUIRED") || msg.includes("تغيير كلمة المرور")) {
          setSession((old) => (old ? { ...old, mustChangePassword: true } : old));
        } else if (msg.includes("انتهت الجلسة") || msg.includes("AUTH_")) {
          logout();
        } else {
          setPageError(msg);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [session?.token, refresh, logout]);

  useEffect(() => {
    if (!session?.token || session.mustChangePassword || user?.mustChangePassword) return;
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let attempts = 0;
    const connect = async () => {
      if (!active) return;
      try {
        let wsUrl = liveSocketUrl(session.token, false);
        try {
          const ticketResp = await api.wsTicket(session.token);
          if (ticketResp?.ticket) {
            wsUrl = liveSocketUrl(ticketResp.ticket, true);
          }
        } catch {
          // fallback to token parameter if ws-ticket endpoint is unreachable
        }
        if (!active) return;
        socket = new WebSocket(wsUrl);
        socket.onopen = () => {
          attempts = 0;
          setSocketLive(true);
        };
        socket.onmessage = (event) => {
          try {
            const frame = JSON.parse(String(event.data));
            if (frame.type === "SNAPSHOT" && Array.isArray(frame.devices)) {
              setDevices(frame.devices);
            }
            if (frame.type === "DEVICE_UPDATE" && Array.isArray(frame.devices)) {
              setDevices((prev) => {
                const byId = new Map(prev.map((x) => [x.device.id, x]));
                frame.devices.forEach((x: DeviceBundle) => byId.set(x.device.id, x));
                return Array.from(byId.values());
              });
            }
            if (frame.type === "ERROR") setPageError(String(frame.error ?? "WebSocket error"));
          } catch {
            /* ignore malformed live frame */
          }
        };
        socket.onclose = () => {
          setSocketLive(false);
          if (active) {
            attempts += 1;
            retryTimer = window.setTimeout(
              connect,
              Math.min(30000, 1000 * 2 ** Math.min(attempts, 5))
            );
          }
        };
        socket.onerror = () => setSocketLive(false);
      } catch {
        setSocketLive(false);
      }
    };
    connect();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [session?.token, session?.mustChangePassword, user?.mustChangePassword]);

  useEffect(() => {
    if (!session?.token) return;
    const timer = window.setInterval(() => {
      api
        .health()
        .then(setHealth)
        .catch(() => setHealth(null));
    }, 30000);
    return () => window.clearInterval(timer);
  }, [session?.token]);

  const customerCount = users.filter((u) => u.role === "CUSTOMER" && u.isActive).length;
  const adminCount = users.filter((u) => u.role === "ADMIN" && u.isActive).length;
  const onlineCount = devices.filter((d) => isOnline(d.device)).length;
  const waitingCount = devices.filter(
    (d) => d.subscription?.status === "AWAITING_FIRST_CONNECTION"
  ).length;
  const locatedCount = devices.filter(
    (d) => d.device.hasValidFix && d.device.lastLat !== null && d.device.lastLng !== null
  ).length;

  const filteredDevices = useMemo(
    () =>
      devices.filter((x) => {
        const q = search.trim().toLowerCase();
        return (
          !q ||
          [
            x.device.vehicleName,
            x.device.plateNumber,
            x.device.imei,
            x.device.serialNumber,
            x.customer?.fullName,
            x.customer?.phone
          ].some((v) => String(v ?? "").toLowerCase().includes(q))
        );
      }),
    [devices, search]
  );

  const filteredUsers = useMemo(
    () =>
      users.filter((u) => {
        const q = userSearch.trim().toLowerCase();
        return (
          !q ||
          [u.fullName, u.username, u.phone, u.email, u.role].some((v) =>
            String(v ?? "").toLowerCase().includes(q)
          )
        );
      }),
    [users, userSearch]
  );

  async function runAction(
    action: () => Promise<unknown>,
    message: string,
    keepVehicleOpen = false
  ) {
    if (!session) return;
    setBusy(true);
    try {
      await action();
      await refresh();
      if (selectedCustomerDetails) {
        try {
          const freshCust = await api.customerDetails(
            session.token,
            selectedCustomerDetails.customer.id
          );
          setSelectedCustomerDetails(freshCust);
        } catch {
          // ignore if customer was deleted
        }
      }
      if (keepVehicleOpen && selectedDevice) {
        try {
          const freshDev = await api.deviceDetails(session.token, selectedDevice.device.id);
          setSelectedDevice(freshDev);
        } catch {
          setSelectedDevice(null);
        }
      } else {
        setSelectedDevice(null);
      }
      notify(message);
      setModal(null);
    } catch (err) {
      notify(err instanceof Error ? err.message : "تعذر تنفيذ العملية");
    } finally {
      setBusy(false);
    }
  }

  function openAddVehicleModal(forCustomerId = "") {
    setPreselectedCustomerId(forCustomerId);
    setFormImei("");
    setFormSerialNumber("");
    setFormVehicleType("CAR");
    setFormVehicleIcon("car");
    setModal("device");
  }

  function openEditVehicleModal(bundle: DeviceBundle) {
    setSelectedDevice(bundle);
    setFormSerialNumber(bundle.device.serialNumber ?? "");
    setFormVehicleType((bundle.device.vehicleType as VehicleType) || "CAR");
    setFormVehicleIcon((bundle.device.vehicleIcon as VehicleIcon) || "car");
    setModal("vehicle_edit");
  }

  async function submitUserCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;
    const f = new FormData(e.currentTarget);
    const emailVal = String(f.get("email") ?? "").trim();
    await runAction(
      () =>
        api.createUser(session.token, {
          fullName: f.get("fullName"),
          phone: f.get("phone"),
          username: f.get("username"),
          password: f.get("password"),
          role: f.get("role") || "CUSTOMER",
          ...(emailVal ? { email: emailVal } : {})
        }),
      "تم إنشاء حساب المستخدم"
    );
  }

  async function submitUserEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session || !editingUser) return;
    const f = new FormData(e.currentTarget);
    const newPassword = String(f.get("password") ?? "").trim();
    await runAction(async () => {
      await api.updateUser(session.token, editingUser.id, {
        fullName: f.get("fullName"),
        phone: f.get("phone"),
        username: f.get("username"),
        role: f.get("role"),
        ...(newPassword ? { password: newPassword } : {})
      });
      setEditingUser(null);
    }, "تم تحديث بيانات المستخدم");
  }

  async function handleToggleUserActive(targetUser: User) {
    if (!session) return;
    await runAction(
      () => api.setUserStatus(session.token, targetUser.id, !targetUser.isActive),
      targetUser.isActive ? "تم إيقاف الحساب" : "تم تفعيل الحساب"
    );
  }

  async function handleDeleteUser(targetUser: User) {
    if (!session) return;
    if (!window.confirm(`هل أنت متأكد من حذف المستخدم "${targetUser.fullName}"؟`)) return;
    await runAction(async () => {
      await api.deleteUser(session.token, targetUser.id);
      if (selectedCustomerDetails?.customer.id === targetUser.id) {
        setSelectedCustomerDetails(null);
        setPage("customers");
      }
    }, "تم حذف المستخدم");
  }

  async function submitDevice(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;
    const f = new FormData(e.currentTarget);
    const sendSmsNow = f.get("sendActivationSmsNow") === "on";
    const idempotencyKey = `reg-${formImei.trim()}-${Date.now()}`;
    await runAction(
      () =>
        api.activateDevice(session.token, {
          profileId: f.get("profileId"),
          imei: formImei.trim(),
          serialNumber: formSerialNumber.trim() || null,
          customerId: f.get("customerId"),
          vehicleName: f.get("vehicleName"),
          vehicleType: formVehicleType,
          vehicleIcon: formVehicleIcon,
          plateNumber: f.get("plateNumber"),
          planDuration: f.get("planDuration"),
          simLocalWithoutPlus20: f.get("simLocalWithoutPlus20"),
          sendActivationSmsNow: sendSmsNow,
          idempotencyKey
        }),
      sendSmsNow ? "تم تسجيل المركبة وإرسال رسالة التفعيل" : "تم تسجيل المركبة بنجاح"
    );
  }

  async function submitVehicleEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session || !selectedDevice) return;
    const f = new FormData(e.currentTarget);
    await runAction(
      () =>
        api.updateVehicle(session.token, selectedDevice.device.id, {
          vehicleName: f.get("vehicleName"),
          vehicleType: formVehicleType,
          vehicleIcon: formVehicleIcon,
          plateNumber: f.get("plateNumber"),
          serialNumber: formSerialNumber.trim() || null,
          simLocalWithoutPlus20: f.get("simLocalWithoutPlus20")
        }),
      "تم تحديث بيانات المركبة",
      true
    );
  }

  async function handleSendActivationSms(deviceId: string, forceResend = false) {
    if (!session || smsSendingDeviceId === deviceId) return;
    setSmsSendingDeviceId(deviceId);
    const idempotencyKey = forceResend
      ? `resend-${deviceId}-${Date.now()}`
      : `initial-${deviceId}`;
    try {
      const res = await api.sendActivationSms(session.token, deviceId, idempotencyKey, forceResend);
      await refresh();
      if (selectedCustomerDetails) {
        const freshCust = await api.customerDetails(
          session.token,
          selectedCustomerDetails.customer.id
        );
        setSelectedCustomerDetails(freshCust);
      }
      if (selectedDevice && selectedDevice.device.id === deviceId) {
        const freshDev = await api.deviceDetails(session.token, deviceId);
        setSelectedDevice(freshDev);
      }
      notify(
        res.duplicatePrevented
          ? "تم منع تكرار الإرسال — رسالة التفعيل أُرسلت مسبقًا"
          : "تم إرسال رسالة التفعيل إلى شريحة الجهاز"
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : "تعذر إرسال رسالة التفعيل");
    } finally {
      setSmsSendingDeviceId(null);
    }
  }

  async function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;
    const f = new FormData(e.currentTarget);
    await runAction(
      () =>
        api.createProfile(session.token, {
          manufacturer: f.get("manufacturer"),
          model: f.get("model"),
          firmwareVersion: f.get("firmwareVersion"),
          traccarProtocol: f.get("traccarProtocol") || "gt06",
          serverHost: f.get("serverHost"),
          serverPort: Number(f.get("serverPort") || 5023),
          transport: "TCP",
          serverMode: "DOMAIN",
          requiresDevicePassword: false,
          requiresGprsonCommand: f.get("requiresGprsonCommand") === "on",
          serverCommandTemplate: f.get("serverCommandTemplate"),
          gprsonCommandTemplate: f.get("gprsonCommandTemplate") || null,
          isVerified: false
        }),
      "تم حفظ ملف الجهاز كغير معتمد"
    );
  }

  async function submitDeviceAction(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session || !selectedDevice) return;
    const f = new FormData(e.currentTarget);
    const id = selectedDevice.device.id;
    if (modal === "renew") {
      await runAction(
        () => api.renew(session.token, id, String(f.get("planDuration"))),
        "تم تجديد الاشتراك",
        true
      );
    }
    if (modal === "reassign") {
      await runAction(
        () => api.reassign(session.token, id, String(f.get("customerId")), String(f.get("reason"))),
        "تم نقل ملكية المركبة",
        true
      );
    }
    if (modal === "override") {
      await runAction(
        () => api.overrideActivation(session.token, id, String(f.get("reason"))),
        "تم تسجيل التفعيل الإداري",
        true
      );
    }
    if (modal === "suspend") {
      await runAction(
        () => api.suspend(session.token, id, String(f.get("reason"))),
        "تم إيقاف الاشتراك مؤقتًا",
        true
      );
    }
    if (modal === "resume") {
      await runAction(
        () => api.resume(session.token, id, String(f.get("reason"))),
        "تم استئناف الاشتراك",
        true
      );
    }
  }

  async function triggerDeviceCommand(
    deviceId: string,
    cmd: DeviceCommandType,
    confirmedSensitive = false
  ) {
    if (!session) return;
    const parameters: Record<string, unknown> = {};
    if (cmd.parameters.includes("data") && cmdParamText.trim()) {
      parameters.data = cmdParamText.trim();
    }
    if (cmd.parameters.includes("timezone") && cmdParamText.trim()) {
      parameters.timezone = cmdParamText.trim();
    }
    if ((cmd.sensitive || cmd.requiresConfirmation) && !confirmedSensitive) {
      setPendingSensitiveCmd({ deviceId, cmd, parameters });
      setModal("confirm_command");
      return;
    }
    await runAction(
      async () => {
        await api.sendCommand(session.token, deviceId, {
          type: cmd.type,
          parameters,
          confirmedSensitive: true
        });
        setPendingSensitiveCmd(null);
        setCmdParamText("");
      },
      `تم إرسال الأمر: ${cmd.labelAr}`,
      true
    );
  }

  async function loadRoute(deviceId: string) {
    if (!session) return;
    setRouteDeviceId(deviceId);
    setRoutePoints([]);
    try {
      const points = await api.routeHistory(
        session.token,
        deviceId,
        new Date(routeFrom).toISOString(),
        new Date(routeTo).toISOString()
      );
      setRoutePoints(points);
      setPage("reports");
    } catch (err) {
      notify(err instanceof Error ? err.message : "تعذر تحميل المسار");
    }
  }

  if (!session) {
    return (
      <Login
        onLogin={(s) => {
          setSession(s);
          setUser(s.user);
        }}
      />
    );
  }
  if (session.mustChangePassword || user?.mustChangePassword) {
    return (
      <PasswordChange
        session={session}
        onDone={(s) => {
          setSession(s);
          setUser(s.user);
          notify("تم تحديث كلمة المرور");
        }}
        onLogout={logout}
      />
    );
  }

  const nav: Array<{ id: Page; label: string; icon: typeof Activity; admin?: boolean }> = [
    { id: "overview" as Page, label: "نظرة عامة", icon: LayoutDashboard },
    { id: "live" as Page, label: "التتبع المباشر", icon: MapPinned },
    { id: "devices" as Page, label: "المركبات والأجهزة", icon: CarFront },
    { id: "subscriptions" as Page, label: "الاشتراكات", icon: CreditCard, admin: true },
    { id: "customers" as Page, label: "المستخدمون والعملاء", icon: Users, admin: true },
    { id: "profiles" as Page, label: "ملفات الأجهزة", icon: Boxes, admin: true },
    { id: "reports" as Page, label: "سجل الحركة", icon: FileClock },
    { id: "fleet_tools" as Page, label: "مركز الأسطول", icon: Activity },
    { id: "system" as Page, label: "حالة النظام", icon: Settings2, admin: true }
  ].filter((x) => !x.admin || isAdmin);

  const activeNavId = page === "customer_details" ? "customers" : page;

  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebarOpen ? "sidebar-open" : "")}>
        <div className="sidebar-brand">
          <div className="brand-mark small">
            <Gauge size={20} />
          </div>
          <div>
            <b>
              VELO<span>TRACK</span>
            </b>
            <small>FLEET MANAGEMENT</small>
          </div>
          <button className="sidebar-close icon-btn" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="sidebar-label">القائمة الرئيسية</div>
        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={"nav-link " + (activeNavId === item.id ? "active" : "")}
                onClick={() => {
                  setPage(item.id);
                  setSidebarOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.id === "live" && socketLive && <i className="nav-live" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="server-mini">
            <span className={health?.supabaseConnected ? "status-dot good" : "status-dot bad"} />
            <div>
              <b>
                {health?.supabaseConnected ? "قاعدة البيانات متصلة" : "قاعدة البيانات غير مؤكدة"}
              </b>
              <small>{health?.traccarConnected ? "Traccar متصل" : "Traccar غير متصل"}</small>
            </div>
          </div>
          <div className="user-mini">
            <div className="avatar">{(user?.fullName ?? "V").slice(0, 1)}</div>
            <div className="user-mini-info">
              <b>{user?.fullName ?? user?.username}</b>
              <small>{roleLabel(user?.role)}</small>
            </div>
            <button className="icon-btn" onClick={logout} aria-label="تسجيل الخروج">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          className="mobile-shade"
          onClick={() => setSidebarOpen(false)}
          aria-label="إغلاق القائمة"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button className="menu-toggle icon-btn" onClick={() => setSidebarOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <span>VeloTrack</span>
              <b>/</b>
              <strong>{pageNames[page]}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={"connection-tag " + (socketLive ? "connected" : "")}>
              <span className="status-dot" />
              {socketLive ? "مباشر" : "غير مباشر"}
            </span>
            <button className="icon-btn" onClick={() => refresh()} aria-label="تحديث">
              <RefreshCw size={18} />
            </button>
            <button className="icon-btn notification-btn" aria-label="الإشعارات">
              <Bell size={18} />
              <i />
            </button>
            <div className="top-avatar">{(user?.fullName ?? "V").slice(0, 1)}</div>
          </div>
        </header>
        <div className="content-area">
          {pageError && (
            <div className="alert-banner">
              <AlertTriangle size={17} />
              {pageError}
              <button onClick={() => setPageError("")}>
                <X size={16} />
              </button>
            </div>
          )}

          {page === "overview" && (
            <>
              <PageTitle
                title="نظرة عامة"
                action={
                  <button className="secondary-btn" onClick={() => refresh()}>
                    <RefreshCw size={16} /> تحديث البيانات
                  </button>
                }
              />
              <div className="welcome-strip">
                <div>
                  <span className="eyebrow">مرحبًا، {user?.fullName ?? user?.username}</span>
                  <h2>مركز إدارة الأسطول</h2>
                </div>
                <div className="welcome-art">
                  <Gauge size={72} strokeWidth={1.1} />
                  <span>LIVE DATA</span>
                </div>
              </div>
              <div className="metrics-grid">
                <Metric
                  label="إجمالي المركبات"
                  value={devices.length}
                  hint=""
                  icon={CarFront}
                  tone="tone-blue"
                />
                <Metric
                  label="المركبات المتصلة"
                  value={onlineCount}
                  hint=""
                  icon={Wifi}
                  tone="tone-green"
                />
                <Metric
                  label="العملاء النشطون"
                  value={isAdmin ? customerCount : "—"}
                  hint=""
                  icon={Users}
                  tone="tone-gold"
                />
                <Metric
                  label="بانتظار أول اتصال"
                  value={waitingCount}
                  hint=""
                  icon={Clock3}
                  tone="tone-violet"
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel map-preview">
                  <div className="panel-head">
                    <div>
                      <h3>مواقع الأسطول ({locatedCount})</h3>
                    </div>
                    <button className="text-btn" onClick={() => setPage("live")}>
                      عرض الخريطة <ArrowDownLeft size={15} />
                    </button>
                  </div>
                  <MapPanel
                    devices={devices}
                    onSelectDevice={(b) => setSelectedDevice(b)}
                    onOpenDetails={openVehicleDetails}
                  />
                </section>
                <section className="panel status-panel">
                  <div className="panel-head">
                    <h3>حالة الاتصال</h3>
                    <Signal size={18} />
                  </div>
                  <div className="status-count">
                    <div className="status-total">{devices.length}</div>
                    <span>مركبة</span>
                  </div>
                  <div className="status-bar">
                    <i
                      style={{
                        width: devices.length ? (onlineCount / devices.length) * 100 + "%" : "0%"
                      }}
                    />
                  </div>
                  <div className="legend-row">
                    <span>
                      <i className="legend-dot online" />
                      متصل
                    </span>
                    <b>{onlineCount}</b>
                  </div>
                  <div className="legend-row">
                    <span>
                      <i className="legend-dot offline" />
                      غير متصل
                    </span>
                    <b>{devices.length - onlineCount}</b>
                  </div>
                  <div className="legend-row">
                    <span>
                      <i className="legend-dot waiting" />
                      بانتظار الاتصال
                    </span>
                    <b>{waitingCount}</b>
                  </div>
                  <div className="system-state">
                    <div className="system-state-line">
                      <Database size={16} />
                      قاعدة البيانات
                      <span className={health?.supabaseConnected ? "state-ok" : "state-warn"}>
                        {health?.supabaseConnected ? "متصلة" : "غير مؤكدة"}
                      </span>
                    </div>
                    <div className="system-state-line">
                      <Globe2 size={16} />
                      Traccar
                      <span className={health?.traccarConnected ? "state-ok" : "state-warn"}>
                        {health?.traccarConnected ? "متصل" : "غير متصل"}
                      </span>
                    </div>
                  </div>
                </section>
              </div>
              <section className="panel table-panel">
                <div className="panel-head">
                  <div>
                    <h3>أحدث المركبات</h3>
                  </div>
                  <button className="text-btn" onClick={() => setPage("devices")}>
                    كل المركبات <ArrowDownLeft size={15} />
                  </button>
                </div>
                {devices.length ? (
                  <DeviceTable
                    data={devices.slice(0, 6)}
                    onOpen={openVehicleDetails}
                    onSendSms={isAdmin ? (id) => handleSendActivationSms(id, false) : undefined}
                    smsSendingId={smsSendingDeviceId}
                  />
                ) : (
                  <Empty
                    title="لا توجد مركبات مسجلة"
                    action={
                      isAdmin ? (
                        <button className="text-btn" onClick={() => openAddVehicleModal()}>
                          إضافة أول مركبة <Plus size={15} />
                        </button>
                      ) : undefined
                    }
                  />
                )}
              </section>
            </>
          )}

          {page === "live" && (
            <>
              <PageTitle
                title="التتبع المباشر"
                action={
                  <span className={"connection-tag " + (socketLive ? "connected" : "")}>
                    <span className="status-dot" />
                    {socketLive ? "اتصال مباشر" : "إعادة الاتصال..."}
                  </span>
                }
              />
              <div className="live-layout">
                <div className="panel live-map">
                  <div className="panel-head">
                    <h3>خريطة المركبات</h3>
                    <span className="map-counter">
                      <i className="live-dot" />
                      {locatedCount} موقع
                    </span>
                  </div>
                  <MapPanel
                    devices={devices}
                    selectedId={selectedDevice?.device.id}
                    onOpenDetails={openVehicleDetails}
                  />
                </div>
                <div className="panel live-list">
                  <div className="panel-head">
                    <h3>المركبات</h3>
                    <span>{devices.length}</span>
                  </div>
                  {devices.length ? (
                    devices.map((x) => (
                      <button
                        className={
                          "live-device " +
                          (selectedDevice?.device.id === x.device.id ? "selected" : "")
                        }
                        key={x.device.id}
                        onClick={() => openVehicleDetails(x)}
                      >
                        <VehicleSvgBadge
                          icon={x.device.vehicleIcon}
                          online={isOnline(x.device)}
                        />
                        <span className="live-device-name">
                          <b>{x.device.vehicleName}</b>
                          <small>{x.device.plateNumber || x.device.imei}</small>
                        </span>
                        <Pill value={x.device.connectionState} />
                      </button>
                    ))
                  ) : (
                    <Empty title="لا توجد مركبات" />
                  )}
                </div>
              </div>
            </>
          )}

          {page === "devices" && (
            <>
              <PageTitle
                title="المركبات والأجهزة"
                action={
                  isAdmin ? (
                    <button className="primary-btn" onClick={() => openAddVehicleModal()}>
                      <Plus size={17} /> إضافة مركبة
                    </button>
                  ) : undefined
                }
              />
              <section className="panel table-panel">
                <div className="toolbar">
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      placeholder="بحث بالاسم أو اللوحة أو IMEI أو الرقم التسلسلي"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="toolbar-right">
                    <span className="muted-label">{filteredDevices.length} مركبة</span>
                    <button className="icon-btn" onClick={() => refresh()}>
                      <Filter size={17} />
                    </button>
                  </div>
                </div>
                {filteredDevices.length ? (
                  <DeviceTable
                    data={filteredDevices}
                    onOpen={openVehicleDetails}
                    onSendSms={isAdmin ? (id) => handleSendActivationSms(id, false) : undefined}
                    smsSendingId={smsSendingDeviceId}
                  />
                ) : (
                  <Empty
                    title="لا توجد نتائج"
                    action={
                      isAdmin && !devices.length ? (
                        <button className="text-btn" onClick={() => openAddVehicleModal()}>
                          إضافة مركبة <Plus size={15} />
                        </button>
                      ) : undefined
                    }
                  />
                )}
              </section>
            </>
          )}

          {page === "subscriptions" && (
            <>
              <PageTitle
                title="الاشتراكات"
                action={
                  <span className="muted-label">
                    {devices.filter((d) => d.subscription).length} اشتراك
                  </span>
                }
              />
              <div className="metrics-grid">
                <Metric
                  label="نشط"
                  value={devices.filter((d) => d.subscription?.status === "ACTIVE").length}
                  hint=""
                  icon={CreditCard}
                  tone="tone-green"
                />
                <Metric
                  label="بانتظار أول اتصال"
                  value={waitingCount}
                  hint=""
                  icon={Clock3}
                  tone="tone-gold"
                />
                <Metric
                  label="منتهي"
                  value={devices.filter((d) => d.subscription?.status === "EXPIRED").length}
                  hint=""
                  icon={AlertTriangle}
                  tone="tone-violet"
                />
                <Metric
                  label="موقوف"
                  value={devices.filter((d) => d.subscription?.status === "SUSPENDED").length}
                  hint=""
                  icon={PauseCircle}
                  tone="tone-blue"
                />
              </div>
              <section className="panel table-panel">
                <div className="panel-head">
                  <h3>قائمة الاشتراكات</h3>
                </div>
                <div className="data-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>المركبة</th>
                        <th>العميل</th>
                        <th>الخطة</th>
                        <th>الحالة</th>
                        <th>تاريخ البداية</th>
                        <th>تاريخ الانتهاء</th>
                        <th>الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {devices
                        .filter((d) => d.subscription)
                        .map((bundle) => (
                          <tr key={bundle.device.id}>
                            <td>
                              <div className="table-person">
                                <VehicleSvgBadge
                                  icon={bundle.device.vehicleIcon}
                                  online={isOnline(bundle.device)}
                                />
                                <div>
                                  <b>{bundle.device.vehicleName}</b>
                                  <small>{bundle.device.plateNumber || bundle.device.imei}</small>
                                </div>
                              </div>
                            </td>
                            <td>{bundle.customer?.fullName ?? "—"}</td>
                            <td>{statusText(bundle.subscription?.planDuration)}</td>
                            <td>
                              <Pill value={bundle.subscription?.status ?? "—"} />
                            </td>
                            <td>{formatDate(bundle.subscription?.startedAtMs)}</td>
                            <td>
                              {bundle.subscription?.planDuration === "LIFETIME"
                                ? "مدى الحياة"
                                : formatDate(bundle.subscription?.expiresAtMs)}
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="icon-btn"
                                  aria-label="تفاصيل المركبة"
                                  onClick={() => openVehicleDetails(bundle)}
                                >
                                  <MoreHorizontal size={17} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="تجديد الاشتراك"
                                  onClick={() => {
                                    setSelectedDevice(bundle);
                                    setModal("renew");
                                  }}
                                >
                                  <RefreshCw size={16} />
                                </button>
                                {bundle.subscription?.status === "SUSPENDED" ? (
                                  <button
                                    className="icon-btn"
                                    aria-label="استئناف الاشتراك"
                                    onClick={() => {
                                      setSelectedDevice(bundle);
                                      setModal("resume");
                                    }}
                                  >
                                    <PlayCircle size={16} />
                                  </button>
                                ) : (
                                  <button
                                    className="icon-btn"
                                    aria-label="إيقاف الاشتراك مؤقتًا"
                                    onClick={() => {
                                      setSelectedDevice(bundle);
                                      setModal("suspend");
                                    }}
                                  >
                                    <PauseCircle size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!devices.some((d) => d.subscription) && <Empty title="لا توجد اشتراكات" />}
              </section>
            </>
          )}

          {page === "customers" && (
            <>
              <PageTitle
                title="المستخدمون والعملاء"
                action={
                  <button className="primary-btn" onClick={() => setModal("user_create")}>
                    <Plus size={17} /> إضافة مستخدم
                  </button>
                }
              />
              <div className="metrics-grid compact-metrics">
                <Metric
                  label="العملاء النشطون"
                  value={customerCount}
                  hint=""
                  icon={Users}
                  tone="tone-blue"
                />
                <Metric
                  label="مديرو النظام"
                  value={adminCount}
                  hint=""
                  icon={ShieldCheck}
                  tone="tone-gold"
                />
                <Metric
                  label="إجمالي المركبات المسندة"
                  value={devices.length}
                  hint=""
                  icon={CarFront}
                  tone="tone-green"
                />
              </div>
              <section className="panel table-panel">
                <div className="toolbar">
                  <div className="search-box">
                    <Search size={17} />
                    <input
                      placeholder="بحث بالاسم أو اسم المستخدم أو رقم الهاتف"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                    />
                  </div>
                  <div className="toolbar-right">
                    <span className="muted-label">{filteredUsers.length} مستخدم</span>
                  </div>
                </div>
                <div className="data-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الاسم الكامل</th>
                        <th>اسم المستخدم</th>
                        <th>رقم الهاتف</th>
                        <th>الصلاحية</th>
                        <th>المركبات</th>
                        <th>الحالة</th>
                        <th>تاريخ الإنشاء</th>
                        <th>الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => {
                        const count =
                          u.vehicleCount ??
                          devices.filter((d) => d.device.currentCustomerId === u.id).length;
                        return (
                          <tr
                            key={u.id}
                            className="click-row"
                            onClick={() => openCustomerDetailsPage(u.id)}
                          >
                            <td>
                              <div className="table-person">
                                <span className="avatar">{u.fullName.slice(0, 1)}</span>
                                <b>{u.fullName}</b>
                              </div>
                            </td>
                            <td dir="ltr">{u.username || "—"}</td>
                            <td dir="ltr">{u.phone || "—"}</td>
                            <td>{roleLabel(u.role)}</td>
                            <td>{count}</td>
                            <td>
                              <Pill value={u.isActive ? "ACTIVE" : "SUSPENDED"} />
                            </td>
                            <td>{formatDate(u.createdAtMs)}</td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="row-actions">
                                <button
                                  className="icon-btn"
                                  aria-label="عرض تفاصيل العميل"
                                  onClick={() => openCustomerDetailsPage(u.id)}
                                >
                                  <Eye size={16} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="إضافة مركبة للعميل"
                                  onClick={() => openAddVehicleModal(u.id)}
                                >
                                  <Plus size={16} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="تعديل المستخدم"
                                  onClick={() => {
                                    setEditingUser(u);
                                    setModal("user_edit");
                                  }}
                                >
                                  <Edit3 size={16} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label={u.isActive ? "إيقاف الحساب" : "تفعيل الحساب"}
                                  onClick={() => handleToggleUserActive(u)}
                                >
                                  <Power size={16} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="حذف المستخدم"
                                  onClick={() => handleDeleteUser(u)}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!filteredUsers.length && (
                  <Empty
                    title="لا يوجد مستخدمون مسجلون"
                    action={
                      <button className="text-btn" onClick={() => setModal("user_create")}>
                        إضافة مستخدم <Plus size={15} />
                      </button>
                    }
                  />
                )}
              </section>
            </>
          )}

          {page === "customer_details" && selectedCustomerDetails && (
            <>
              <PageTitle
                title={selectedCustomerDetails.customer.fullName}
                action={
                  <>
                    <button className="secondary-btn" onClick={() => setPage("customers")}>
                      <ArrowRight size={16} /> العودة للقائمة
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => {
                        setEditingUser(selectedCustomerDetails.customer);
                        setModal("user_edit");
                      }}
                    >
                      <Edit3 size={16} /> تعديل الحساب
                    </button>
                    <button
                      className="primary-btn"
                      onClick={() => openAddVehicleModal(selectedCustomerDetails.customer.id)}
                    >
                      <Plus size={17} /> إضافة مركبة للعميل
                    </button>
                  </>
                }
              />

              <section className="panel customer-summary-bar">
                <div className="customer-meta-item">
                  <span>اسم المستخدم</span>
                  <b dir="ltr">{selectedCustomerDetails.customer.username || "—"}</b>
                </div>
                <div className="customer-meta-item">
                  <span>رقم الهاتف</span>
                  <b dir="ltr">{selectedCustomerDetails.customer.phone || "—"}</b>
                </div>
                <div className="customer-meta-item">
                  <span>الصلاحية</span>
                  <b>{roleLabel(selectedCustomerDetails.customer.role)}</b>
                </div>
                <div className="customer-meta-item">
                  <span>حالة الحساب</span>
                  <Pill value={selectedCustomerDetails.customer.isActive ? "ACTIVE" : "SUSPENDED"} />
                </div>
              </section>

              <div className="metrics-grid metrics-6">
                <Metric
                  label="إجمالي المركبات"
                  value={selectedCustomerDetails.summary.totalVehicles}
                  hint=""
                  icon={CarFront}
                  tone="tone-blue"
                />
                <Metric
                  label="إجمالي الاشتراكات"
                  value={selectedCustomerDetails.summary.totalSubscriptions}
                  hint=""
                  icon={CreditCard}
                  tone="tone-gold"
                />
                <Metric
                  label="اشتراكات نشطة"
                  value={selectedCustomerDetails.summary.activeSubscriptionsCount}
                  hint=""
                  icon={Check}
                  tone="tone-green"
                />
                <Metric
                  label="بانتظار أول اتصال"
                  value={selectedCustomerDetails.summary.pendingSubscriptionsCount}
                  hint=""
                  icon={Clock3}
                  tone="tone-violet"
                />
                <Metric
                  label="اشتراكات منتهية"
                  value={selectedCustomerDetails.summary.expiredSubscriptionsCount}
                  hint=""
                  icon={AlertTriangle}
                  tone="tone-gold"
                />
                <Metric
                  label="اشتراكات موقوفة"
                  value={selectedCustomerDetails.summary.suspendedSubscriptionsCount}
                  hint=""
                  icon={PauseCircle}
                  tone="tone-blue"
                />
              </div>

              <section className="panel table-panel">
                <div className="panel-head">
                  <h3>مركبات واشتراكات العميل</h3>
                  <span className="muted-label">
                    {selectedCustomerDetails.vehicles.length} مركبة
                  </span>
                </div>
                {selectedCustomerDetails.vehicles.length ? (
                  <div className="data-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>المركبة</th>
                          <th>النوع</th>
                          <th>الموديل</th>
                          <th>IMEI / الرقم التسلسلي</th>
                          <th>مدة الاشتراك</th>
                          <th>حالة الاشتراك</th>
                          <th>تاريخ البداية</th>
                          <th>تاريخ الانتهاء</th>
                          <th>حالة الاتصال</th>
                          <th>الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedCustomerDetails.vehicles.map((bundle) => (
                          <tr
                            key={bundle.device.id}
                            className="click-row"
                            onClick={() => openVehicleDetails(bundle)}
                          >
                            <td>
                              <div className="table-person">
                                <VehicleSvgBadge
                                  icon={bundle.device.vehicleIcon}
                                  online={isOnline(bundle.device)}
                                />
                                <div>
                                  <b>{bundle.device.vehicleName}</b>
                                  <small>{bundle.device.plateNumber || "بدون لوحة"}</small>
                                </div>
                              </div>
                            </td>
                            <td>
                              {VEHICLE_TYPE_LABELS[
                                (bundle.device.vehicleType as VehicleType) ?? "CAR"
                              ] ?? bundle.device.vehicleType}
                            </td>
                            <td>
                              {bundle.profile
                                ? `${bundle.profile.manufacturer} ${bundle.profile.model}`
                                : "—"}
                            </td>
                            <td dir="ltr">
                              <div>{bundle.device.imei}</div>
                              {bundle.device.serialNumber && (
                                <small className="muted-label">
                                  S/N: {bundle.device.serialNumber}
                                </small>
                              )}
                            </td>
                            <td>{statusText(bundle.subscription?.planDuration)}</td>
                            <td>
                              <Pill value={bundle.subscription?.status ?? "—"} />
                            </td>
                            <td>{formatDate(bundle.subscription?.startedAtMs)}</td>
                            <td>
                              {bundle.subscription?.planDuration === "LIFETIME"
                                ? "مدى الحياة"
                                : formatDate(bundle.subscription?.expiresAtMs)}
                            </td>
                            <td>
                              <Pill value={bundle.device.connectionState} />
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="row-actions">
                                <button
                                  className="icon-btn"
                                  aria-label="إرسال رسالة التفعيل"
                                  disabled={smsSendingDeviceId === bundle.device.id}
                                  onClick={() => handleSendActivationSms(bundle.device.id, false)}
                                >
                                  <Send size={15} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="تجديد الاشتراك"
                                  onClick={() => {
                                    setSelectedDevice(bundle);
                                    setModal("renew");
                                  }}
                                >
                                  <RefreshCw size={15} />
                                </button>
                                <button
                                  className="icon-btn"
                                  aria-label="تفاصيل المركبة والتحكم"
                                  onClick={() => openVehicleDetails(bundle)}
                                >
                                  <MoreHorizontal size={17} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    title="لا توجد مركبات مسندة لهذا العميل"
                    action={
                      <button
                        className="text-btn"
                        onClick={() => openAddVehicleModal(selectedCustomerDetails.customer.id)}
                      >
                        إضافة مركبة للعميل <Plus size={15} />
                      </button>
                    }
                  />
                )}
              </section>
            </>
          )}

          {page === "profiles" && (
            <>
              <PageTitle
                title="ملفات الأجهزة"
                action={
                  <button className="primary-btn" onClick={() => setModal("profile")}>
                    <Plus size={17} /> ملف جديد
                  </button>
                }
              />
              <section className="profiles-grid">
                {profiles.map((p) => (
                  <article className="panel profile-card" key={p.id}>
                    <div className="profile-card-top">
                      <div className="profile-symbol">
                        <Smartphone size={22} />
                      </div>
                      <Pill value={p.isVerified ? "ACTIVE" : "PENDING"} />
                    </div>
                    <h3>
                      {p.manufacturer} {p.model}
                    </h3>
                    <p className="profile-firmware">
                      {p.firmwareVersion} · {p.traccarProtocol}
                    </p>
                    <div className="profile-data">
                      <span>الخادم</span>
                      <b>
                        {p.serverHost}:{p.serverPort}
                      </b>
                      <span>النقل</span>
                      <b>{p.transport}</b>
                    </div>
                    <div className="profile-command">
                      <small>SERVER COMMAND</small>
                      <code>{p.serverCommandTemplate}</code>
                    </div>
                    {!p.isVerified && (
                      <button
                        className="secondary-btn full-btn"
                        onClick={() => {
                          if (
                            window.confirm(
                              "هل تم اختبار هذا الملف فعليًا على الجهاز والـ Firmware المحدد؟"
                            )
                          ) {
                            runAction(
                              () => api.verifyProfile(session.token, p.id),
                              "تم اعتماد الملف بعد الاختبار"
                            );
                          }
                        }}
                      >
                        <ShieldCheck size={16} /> اعتماد بعد الاختبار الفعلي
                      </button>
                    )}
                  </article>
                ))}
                {!profiles.length && (
                  <div className="panel profile-empty">
                    <Empty
                      title="لا توجد ملفات أجهزة"
                      action={
                        <button className="text-btn" onClick={() => setModal("profile")}>
                          إضافة ملف <Plus size={15} />
                        </button>
                      }
                    />
                  </div>
                )}
              </section>
            </>
          )}

          {page === "reports" && (
            <>
              <PageTitle
                title="سجل الحركة"
                action={<span className="muted-label">بيانات من Traccar</span>}
              />
              <section className="panel reports-panel">
                <div className="report-filters">
                  <label>
                    المركبة
                    <select
                      value={routeDeviceId}
                      onChange={(e) => setRouteDeviceId(e.target.value)}
                    >
                      <option value="">اختر مركبة</option>
                      {devices.map((d) => (
                        <option key={d.device.id} value={d.device.id}>
                          {d.device.vehicleName} · {d.device.imei}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    من
                    <input
                      type="datetime-local"
                      value={routeFrom}
                      onChange={(e) => setRouteFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    إلى
                    <input
                      type="datetime-local"
                      value={routeTo}
                      onChange={(e) => setRouteTo(e.target.value)}
                    />
                  </label>
                  <button
                    className="primary-btn"
                    disabled={!routeDeviceId || busy}
                    onClick={() => loadRoute(routeDeviceId)}
                  >
                    <Search size={16} /> عرض المسار
                  </button>
                </div>
                {routePoints.length ? (
                  <>
                    <div className="route-summary">
                      <b>{routePoints.length}</b>
                      <span>نقطة مسار</span>
                      <span>أول تسجيل: {formatDate(routePoints[0]?.recordedAtMs)}</span>
                      <span>
                        آخر تسجيل: {formatDate(routePoints[routePoints.length - 1]?.recordedAtMs)}
                      </span>
                    </div>
                    <MapPanel devices={devices} route={routePoints} />
                  </>
                ) : (
                  <Empty title="اختر مركبة وفترة زمنية لعرض المسار" />
                )}
              </section>
            </>
          )}


          {page === "fleet_tools" && session && (
            <FleetOperationsPage token={session.token} devices={devices} isAdmin={isAdmin} onNotify={notify} />
          )}

          {page === "system" && (
            <>
              <PageTitle
                title="حالة النظام"
                action={
                  <button
                    className="secondary-btn"
                    onClick={() =>
                      api
                        .health()
                        .then(setHealth)
                        .catch(() => setHealth(null))
                    }
                  >
                    <RefreshCw size={16} /> فحص الآن
                  </button>
                }
              />
              <div className="system-grid">
                <SystemCard
                  icon={Database}
                  title="Supabase / PostgreSQL"
                  ok={!!health?.supabaseConnected}
                  state={
                    health?.supabaseConnected
                      ? "اتصال قاعدة البيانات مؤكد"
                      : "الاتصال غير متاح أو غير مؤكد"
                  }
                />
                <SystemCard
                  icon={Globe2}
                  title="Traccar API"
                  ok={!!health?.traccarConnected}
                  state={
                    health?.traccarConnected ? "جلسة Traccar نشطة" : "لا توجد جلسة Traccar نشطة"
                  }
                />
                <SystemCard
                  icon={Activity}
                  title="Traccar WebSocket"
                  ok={!!health?.traccarWsConnected}
                  state={health?.traccarWsConnected ? "اتصال مباشر" : "غير متصل"}
                />
                <SystemCard
                  icon={Signal}
                  title="Live WebSocket"
                  ok={socketLive}
                  state={
                    socketLive ? "واجهة الويب تستقبل التحديثات" : "واجهة الويب غير متصلة"
                  }
                />
                <SystemCard
                  icon={Smartphone}
                  title="SMS Gateway"
                  ok={!!health?.smsGatewayConfigured}
                  state={health?.smsGatewayConfigured ? "مهيأ" : "غير مهيأ"}
                />
                <SystemCard
                  icon={ShieldCheck}
                  title="جلسة المستخدم"
                  ok
                  state={
                    roleLabel(user?.role) +
                    " · " +
                    (user?.username || user?.phone || user?.email || "")
                  }
                />
              </div>
              <div className="panel system-foot">
                <div>
                  <b>آخر مزامنة Traccar</b>
                  <span>{formatDate(health?.traccarLastSyncAtMs)}</span>
                </div>
                <div>
                  <b>API</b>
                  <span dir="ltr">{API_BASE || "غير مضبوط"}</span>
                </div>
                <div>
                  <b>الإصدار الحالي</b>
                  <span dir="ltr">v{releaseInfo?.currentVersion ?? APP_VERSION}</span>
                </div>
                <div>
                  <b>أحدث إصدار GitHub</b>
                  <span dir="ltr">{releaseInfo?.tagName ?? `v${APP_VERSION}`}</span>
                </div>
                {health?.databaseError && (
                  <div>
                    <b>Database error</b>
                    <code>{health.databaseError}</code>
                  </div>
                )}
                {isAdmin && (
                  <button
                    className="primary-btn"
                    onClick={() =>
                      runAction(() => api.syncTraccar(session.token), "اكتملت مزامنة Traccar")
                    }
                  >
                    <RefreshCw size={16} /> مزامنة Traccar الآن
                  </button>
                )}
              </div>

              <section className="panel detail-section">
                <div className="section-head">
                  <h3>التحديث التلقائي والإصدارات (GitHub Releases)</h3>
                  <div className="row-actions">
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={autoUpdateEnabled}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setAutoUpdateEnabled(next);
                          api.checkUpdate(next).then(setReleaseInfo).catch(() => null);
                        }}
                      />
                      فحص تلقائي من GitHub
                    </label>
                    <button
                      className="secondary-btn"
                      onClick={() => {
                        api
                          .checkUpdate(autoUpdateEnabled)
                          .then((info) => {
                            setReleaseInfo(info);
                            notify(
                              info.updateAvailable
                                ? `يتوفر تحديث جديد ${info.tagName}`
                                : `الإصدار الحالي v${info.currentVersion} محدث`
                            );
                          })
                          .catch(() => null);
                      }}
                    >
                      <RefreshCw size={15} /> فحص GitHub الآن
                    </button>
                    <a
                      className="primary-btn"
                      href={releaseInfo?.htmlUrl ?? `https://github.com/${GITHUB_REPO}/releases`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      صفحة الإصدارات (GitHub)
                    </a>
                    {releaseInfo?.apkDownloadUrl && (
                      <a
                        className="secondary-btn"
                        href={releaseInfo.apkDownloadUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        تنزيل APK
                      </a>
                    )}
                  </div>
                </div>
                <div className="detail-grid">
                  <div>
                    <span>المستودع</span>
                    <b dir="ltr">{releaseInfo?.repository ?? GITHUB_REPO}</b>
                  </div>
                  <div>
                    <span>الإصدار المثبت</span>
                    <b dir="ltr">v{releaseInfo?.currentVersion ?? APP_VERSION}</b>
                  </div>
                  <div>
                    <span>أحدث إصدار منشور</span>
                    <b dir="ltr">{releaseInfo?.tagName ?? `v${APP_VERSION}`}</b>
                  </div>
                  <div>
                    <span>حالة التحديث</span>
                    <Pill
                      value={releaseInfo?.updateAvailable ? "PENDING" : "ACTIVE"}
                      good={!releaseInfo?.updateAvailable}
                    />
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {selectedDevice && !modal && (
        <Modal
          title={selectedDevice.device.vehicleName}
          onClose={() => setSelectedDevice(null)}
          wide
        >
          <div className="device-detail">
            <div className="detail-top">
              <div className="detail-vehicle">
                <VehicleSvgBadge
                  icon={selectedDevice.device.vehicleIcon}
                  online={isOnline(selectedDevice.device)}
                />
                <div>
                  <h2>{selectedDevice.device.vehicleName}</h2>
                  <span>
                    {VEHICLE_TYPE_LABELS[
                      (selectedDevice.device.vehicleType as VehicleType) ?? "CAR"
                    ] ?? selectedDevice.device.vehicleType}{" "}
                    · {selectedDevice.device.plateNumber || "بدون لوحة"} ·{" "}
                    {selectedDevice.device.imei}
                  </span>
                </div>
              </div>
              <Pill value={selectedDevice.device.connectionState} />
            </div>

            <div className="detail-stats">
              <div>
                <small>السرعة</small>
                <b>
                  {selectedDevice.device.lastSpeedKmh ?? "—"} <i>كم/س</i>
                </b>
              </div>
              <div>
                <small>الاشتراك</small>
                <b>{subscriptionLabel(selectedDevice)}</b>
              </div>
              <div>
                <small>حالة التفعيل</small>
                <b>{statusText(selectedDevice.device.activationStatus)}</b>
              </div>
              <div>
                <small>العميل</small>
                <b>{selectedDevice.customer?.fullName ?? "—"}</b>
              </div>
            </div>

            <div className="detail-coords">
              <span>
                LAT <b>{selectedDevice.device.lastLat ?? "—"}</b>
              </span>
              <span>
                LNG <b>{selectedDevice.device.lastLng ?? "—"}</b>
              </span>
              <span>
                IMEI <b>{selectedDevice.device.imei}</b>
              </span>
              {selectedDevice.device.serialNumber && (
                <span>
                  S/N <b>{selectedDevice.device.serialNumber}</b>
                </span>
              )}
              <span>
                SIM{" "}
                <b>
                  {selectedDevice.device.simNumber ||
                    selectedDevice.device.simE164Number ||
                    selectedDevice.device.simLocalNumber ||
                    "—"}
                </b>
              </span>
              <span>
                آخر ظهور <b>{formatDate(selectedDevice.device.lastSeenAtMs)}</b>
              </span>
            </div>

            <div className="detail-actions">
              <button
                className="secondary-btn"
                onClick={() => {
                  const id = selectedDevice.device.id;
                  setRouteDeviceId(id);
                  setModal(null);
                  setSelectedDevice(null);
                  loadRoute(id);
                }}
              >
                سجل الحركة <FileClock size={15} />
              </button>
              {isAdmin && (
                <>
                  <button
                    className="primary-btn"
                    disabled={smsSendingDeviceId === selectedDevice.device.id}
                    onClick={() =>
                      handleSendActivationSms(
                        selectedDevice.device.id,
                        selectedDevice.smsLogs?.length > 0
                      )
                    }
                  >
                    <Send size={15} />{" "}
                    {selectedDevice.smsLogs?.length
                      ? "إعادة إرسال رسالة التفعيل"
                      : "إرسال رسالة التفعيل"}
                  </button>
                  <button
                    className="secondary-btn"
                    onClick={() => openEditVehicleModal(selectedDevice)}
                  >
                    تعديل المركبة <Edit3 size={15} />
                  </button>
                  <button className="secondary-btn" onClick={() => setModal("renew")}>
                    تجديد الاشتراك <RefreshCw size={15} />
                  </button>
                  {selectedDevice.subscription?.status === "SUSPENDED" ? (
                    <button className="secondary-btn" onClick={() => setModal("resume")}>
                      استئناف الاشتراك <PlayCircle size={15} />
                    </button>
                  ) : (
                    <button className="secondary-btn" onClick={() => setModal("suspend")}>
                      إيقاف مؤقت <PauseCircle size={15} />
                    </button>
                  )}
                  <button className="secondary-btn" onClick={() => setModal("reassign")}>
                    نقل الملكية <Users size={15} />
                  </button>
                  <button className="secondary-btn" onClick={() => setModal("override")}>
                    تفعيل إداري <ShieldCheck size={15} />
                  </button>
                </>
              )}
            </div>

            <div className="detail-audit">
              <h4>
                <Terminal size={14} /> أوامر التحكم بالجهاز (Traccar)
              </h4>
              {selectedDevice.supportedCommands?.length ? (
                <div className="command-controls">
                  <div className="command-buttons-grid">
                    {selectedDevice.supportedCommands.map((cmd) => (
                      <button
                        key={cmd.type}
                        type="button"
                        className={cmd.sensitive ? "secondary-btn cmd-danger" : "secondary-btn"}
                        disabled={busy}
                        onClick={() =>
                          triggerDeviceCommand(selectedDevice.device.id, cmd, false)
                        }
                      >
                        <Terminal size={14} /> {cmd.labelAr}
                      </button>
                    ))}
                  </div>
                  {isAdmin && (
                    <input
                      className="cmd-param-input"
                      dir="ltr"
                      value={cmdParamText}
                      onChange={(e) => setCmdParamText(e.target.value)}
                      placeholder="معامل الأمر المخصص أو المنطقة الزمنية (اختياري)"
                    />
                  )}
                </div>
              ) : (
                <span className="muted-label">لا توجد أوامر متاحة حاليًا</span>
              )}
            </div>

            <div className="detail-audit">
              <h4>سجل أوامر التحكم المرسلة</h4>
              {selectedDevice.commandHistory?.length ? (
                selectedDevice.commandHistory.slice(0, 6).map((cmdLog) => (
                  <div className="audit-line" key={cmdLog.id}>
                    <span>{cmdLog.commandType}</span>
                    <code>{formatDate(cmdLog.createdAtMs)}</code>
                    <Pill value={cmdLog.status} />
                  </div>
                ))
              ) : (
                <span className="muted-label">لم يتم إرسال أوامر تحكم بعد</span>
              )}
            </div>

            <div className="detail-audit">
              <h4>سجل رسائل التهيئة (SMS)</h4>
              {selectedDevice.smsLogs?.length ? (
                selectedDevice.smsLogs.map((log) => (
                  <div className="audit-line" key={log.id}>
                    <span>{log.commandKey}</span>
                    <code>{log.commandText}</code>
                    <Pill value={log.status} />
                  </div>
                ))
              ) : (
                <span className="muted-label">لا توجد سجلات رسائل</span>
              )}
            </div>
          </div>
        </Modal>
      )}

      {modal === "confirm_command" && pendingSensitiveCmd && (
        <Modal title="تأكيد إرسال أمر حساس" onClose={() => setModal(null)}>
          <div className="modal-form form-stack">
            <div className="form-note">
              هل أنت متأكد من إرسال الأمر <b>{pendingSensitiveCmd.cmd.labelAr}</b> إلى المركبة؟
            </div>
            <div className="detail-actions">
              <button
                type="button"
                className="primary-btn full-btn"
                disabled={busy}
                onClick={() =>
                  triggerDeviceCommand(
                    pendingSensitiveCmd.deviceId,
                    pendingSensitiveCmd.cmd,
                    true
                  )
                }
              >
                تأكيد الإرسال الفوري
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setPendingSensitiveCmd(null);
                  setModal(null);
                }}
              >
                إلغاء
              </button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "user_create" && (
        <Modal title="إضافة مستخدم جديد" onClose={() => setModal(null)}>
          <form className="form-stack modal-form" onSubmit={submitUserCreate}>
            <label>
              الاسم الكامل
              <input name="fullName" required />
            </label>
            <label>
              رقم الهاتف
              <input name="phone" type="tel" dir="ltr" placeholder="01012345678" required />
            </label>
            <label>
              اسم المستخدم
              <input name="username" dir="ltr" required />
            </label>
            <label>
              كلمة المرور
              <input name="password" type="password" minLength={8} required />
            </label>
            <label>
              الصلاحية
              <select name="role" defaultValue="CUSTOMER">
                <option value="CUSTOMER">عميل (CUSTOMER)</option>
                <option value="ADMIN">مدير النظام (ADMIN)</option>
              </select>
            </label>
            <button className="primary-btn full-btn" disabled={busy}>
              إنشاء الحساب
            </button>
          </form>
        </Modal>
      )}

      {modal === "user_edit" && editingUser && (
        <Modal
          title="تعديل بيانات المستخدم"
          onClose={() => {
            setEditingUser(null);
            setModal(null);
          }}
        >
          <form className="form-stack modal-form" onSubmit={submitUserEdit}>
            <label>
              الاسم الكامل
              <input name="fullName" defaultValue={editingUser.fullName} required />
            </label>
            <label>
              رقم الهاتف
              <input
                name="phone"
                type="tel"
                dir="ltr"
                defaultValue={editingUser.phone ?? ""}
                required
              />
            </label>
            <label>
              اسم المستخدم
              <input
                name="username"
                dir="ltr"
                defaultValue={editingUser.username ?? ""}
                required
              />
            </label>
            <label>
              الصلاحية
              <select name="role" defaultValue={editingUser.role}>
                <option value="CUSTOMER">عميل (CUSTOMER)</option>
                <option value="ADMIN">مدير النظام (ADMIN)</option>
              </select>
            </label>
            <label>
              كلمة مرور جديدة (اختياري)
              <input name="password" type="password" minLength={8} />
            </label>
            <button className="primary-btn full-btn" disabled={busy}>
              حفظ التعديلات
            </button>
          </form>
        </Modal>
      )}

      {modal === "device" && (
        <Modal title="إضافة مركبة وجهاز GPS" onClose={() => setModal(null)} wide>
          <form className="form-grid modal-form" onSubmit={submitDevice}>
            <label>
              اسم المركبة
              <input name="vehicleName" required />
            </label>
            <label>
              رقم اللوحة
              <input name="plateNumber" required />
            </label>
            <label>
              نوع المركبة
              <select
                name="vehicleType"
                value={formVehicleType}
                onChange={(e) => setFormVehicleType(e.target.value as VehicleType)}
              >
                {Object.entries(VEHICLE_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              العميل
              <select
                name="customerId"
                required
                defaultValue={preselectedCustomerId || ""}
              >
                <option value="" disabled>
                  اختر العميل
                </option>
                {users
                  .filter((x) => x.role === "CUSTOMER" && x.isActive)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.fullName} ({x.phone || x.username})
                    </option>
                  ))}
              </select>
            </label>

            <div className="grid-full icon-picker-block">
              <span className="icon-picker-label">أيقونة المركبة على الخريطة</span>
              <div className="icon-picker-grid">
                {VEHICLE_ICON_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    className={
                      "icon-picker-item " + (formVehicleIcon === opt.id ? "selected" : "")
                    }
                    onClick={() => {
                      setFormVehicleIcon(opt.id);
                      setFormVehicleType(opt.typeDefault as VehicleType);
                    }}
                  >
                    <VehicleSvgBadge icon={opt.id} online={formVehicleIcon === opt.id} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <label>
              رقم IMEI (15 رقمًا)
              <div className="input-with-action">
                <input
                  name="imei"
                  dir="ltr"
                  inputMode="numeric"
                  minLength={15}
                  maxLength={15}
                  value={formImei}
                  onChange={(e) => setFormImei(e.target.value.replace(/\D/g, "").slice(0, 15))}
                  required
                />
                <button
                  type="button"
                  className="secondary-btn scan-btn"
                  onClick={() => setScannerOpen(true)}
                >
                  <Camera size={15} /> مسح الباركود
                </button>
              </div>
            </label>

            <label>
              الرقم التسلسلي للجهاز (S/N اختياري)
              <input
                name="serialNumber"
                dir="ltr"
                value={formSerialNumber}
                onChange={(e) => setFormSerialNumber(e.target.value)}
              />
            </label>

            <label>
              رقم شريحة الجهاز بدون +20
              <input name="simLocalWithoutPlus20" dir="ltr" inputMode="numeric" required />
            </label>

            <label>
              ملف الجهاز المعتمد
              <select name="profileId" required defaultValue="">
                <option value="" disabled>
                  اختر ملفًا معتمدًا
                </option>
                {profiles
                  .filter((x) => x.isVerified)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.manufacturer} {x.model} · {x.firmwareVersion}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              مدة الاشتراك
              <select name="planDuration" defaultValue="MONTH_1">
                <option value="MONTH_1">شهر واحد</option>
                <option value="MONTH_3">3 أشهر</option>
                <option value="MONTH_6">6 أشهر</option>
                <option value="MONTH_12">12 شهرًا</option>
                <option value="LIFETIME">مدى الحياة</option>
              </select>
            </label>

            <label className="checkbox-line">
              <input type="checkbox" name="sendActivationSmsNow" defaultChecked /> إرسال رسالة
              التفعيل فور الحفظ
            </label>

            <button
              className="primary-btn full-btn grid-full"
              disabled={
                busy ||
                !isValidImei15(formImei) ||
                !profiles.some((x) => x.isVerified) ||
                !users.some((x) => x.role === "CUSTOMER" && x.isActive)
              }
            >
              حفظ المركبة والجهاز
            </button>
          </form>
        </Modal>
      )}

      {modal === "vehicle_edit" && selectedDevice && (
        <Modal title="تعديل بيانات المركبة" onClose={() => setModal(null)} wide>
          <form className="form-grid modal-form" onSubmit={submitVehicleEdit}>
            <label>
              اسم المركبة
              <input
                name="vehicleName"
                defaultValue={selectedDevice.device.vehicleName}
                required
              />
            </label>
            <label>
              رقم اللوحة
              <input
                name="plateNumber"
                defaultValue={selectedDevice.device.plateNumber}
                required
              />
            </label>
            <label>
              نوع المركبة
              <select
                name="vehicleType"
                value={formVehicleType}
                onChange={(e) => setFormVehicleType(e.target.value as VehicleType)}
              >
                {Object.entries(VEHICLE_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              الرقم التسلسلي للجهاز (S/N)
              <input
                name="serialNumber"
                dir="ltr"
                value={formSerialNumber}
                onChange={(e) => setFormSerialNumber(e.target.value)}
              />
            </label>
            <label className="grid-full">
              رقم شريحة الجهاز بدون +20
              <input
                name="simLocalWithoutPlus20"
                dir="ltr"
                inputMode="numeric"
                defaultValue={(
                  selectedDevice.device.simNumber ||
                  selectedDevice.device.simE164Number ||
                  selectedDevice.device.simLocalNumber ||
                  ""
                ).replace(/^\+20/, "0")}
              />
            </label>

            <div className="grid-full icon-picker-block">
              <span className="icon-picker-label">أيقونة المركبة على الخريطة</span>
              <div className="icon-picker-grid">
                {VEHICLE_ICON_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    className={
                      "icon-picker-item " + (formVehicleIcon === opt.id ? "selected" : "")
                    }
                    onClick={() => setFormVehicleIcon(opt.id)}
                  >
                    <VehicleSvgBadge icon={opt.id} online={formVehicleIcon === opt.id} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <button className="primary-btn full-btn grid-full" disabled={busy}>
              حفظ التعديلات
            </button>
          </form>
        </Modal>
      )}

      {modal === "profile" && (
        <Modal title="ملف جهاز جديد" onClose={() => setModal(null)} wide>
          <form className="form-grid modal-form" onSubmit={submitProfile}>
            <label>
              الشركة المصنعة
              <input name="manufacturer" defaultValue="Concox" required />
            </label>
            <label>
              الموديل
              <input name="model" defaultValue="GT06N" required />
            </label>
            <label>
              إصدار Firmware
              <input name="firmwareVersion" required />
            </label>
            <label>
              بروتوكول Traccar
              <select name="traccarProtocol" defaultValue="gt06">
                <option value="gt06">gt06</option>
                <option value="teltonika">teltonika</option>
                <option value="coban">coban</option>
                <option value="tk103">tk103</option>
              </select>
            </label>
            <label>
              عنوان الخادم
              <input name="serverHost" required />
            </label>
            <label>
              منفذ TCP
              <input name="serverPort" type="number" defaultValue="5023" required />
            </label>
            <label className="grid-full">
              أمر SERVER
              <input
                name="serverCommandTemplate"
                placeholder="SERVER,1,host,5023,0#"
                required
              />
            </label>
            <label className="checkbox-line">
              <input type="checkbox" name="requiresGprsonCommand" /> يتطلب GPRSON
            </label>
            <label>
              أمر GPRSON
              <input name="gprsonCommandTemplate" defaultValue="GPRSON,1#" />
            </label>
            <button className="primary-btn full-btn grid-full" disabled={busy}>
              حفظ الملف
            </button>
          </form>
        </Modal>
      )}

      {["renew", "reassign", "override", "suspend", "resume"].includes(modal ?? "") &&
        selectedDevice && (
          <Modal
            title={
              modal === "renew"
                ? "تجديد الاشتراك"
                : modal === "reassign"
                ? "نقل ملكية المركبة"
                : modal === "suspend"
                ? "إيقاف الاشتراك مؤقتًا"
                : modal === "resume"
                ? "استئناف الاشتراك"
                : "تفعيل إداري"
            }
            onClose={() => setModal(null)}
          >
            <form className="form-stack modal-form" onSubmit={submitDeviceAction}>
              {modal === "renew" && (
                <label>
                  مدة الاشتراك الجديدة
                  <select name="planDuration">
                    <option value="MONTH_1">شهر واحد</option>
                    <option value="MONTH_3">3 أشهر</option>
                    <option value="MONTH_6">6 أشهر</option>
                    <option value="MONTH_12">12 شهرًا</option>
                    <option value="LIFETIME">مدى الحياة</option>
                  </select>
                </label>
              )}
              {modal === "reassign" && (
                <>
                  <label>
                    العميل الجديد
                    <select name="customerId" required>
                      {users
                        .filter((u) => u.role === "CUSTOMER" && u.isActive)
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.fullName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    سبب النقل
                    <input name="reason" required />
                  </label>
                </>
              )}
              {modal === "override" && (
                <label>
                  سبب التفعيل الإداري
                  <input name="reason" required />
                </label>
              )}
              {modal === "suspend" && (
                <label>
                  سبب الإيقاف المؤقت
                  <input name="reason" required />
                </label>
              )}
              {modal === "resume" && (
                <label>
                  ملاحظة استئناف الاشتراك
                  <input name="reason" defaultValue="استئناف اشتراك المركبة" required />
                </label>
              )}
              <button className="primary-btn full-btn" disabled={busy}>
                تأكيد العملية
              </button>
            </form>
          </Modal>
        )}

      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onDetected={(val) => {
            const digits = val.replace(/\D/g, "");
            if (digits.length === 15) {
              setFormImei(digits);
            } else {
              setFormSerialNumber(val);
            }
            setScannerOpen(false);
          }}
        />
      )}

      {toast && (
        <div className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function DeviceTable({
  data,
  onOpen,
  onSendSms,
  smsSendingId
}: {
  data: DeviceBundle[];
  onOpen: (x: DeviceBundle) => void;
  onSendSms?: (deviceId: string) => void;
  smsSendingId?: string | null;
}) {
  return (
    <div className="data-table-wrap">
      <table>
        <thead>
          <tr>
            <th>المركبة</th>
            <th>النوع</th>
            <th>IMEI</th>
            <th>العميل</th>
            <th>الاتصال</th>
            <th>الاشتراك</th>
            <th>آخر ظهور</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.map((x) => (
            <tr key={x.device.id} onClick={() => onOpen(x)} className="click-row">
              <td>
                <div className="table-person">
                  <VehicleSvgBadge
                    icon={x.device.vehicleIcon}
                    online={isOnline(x.device)}
                  />
                  <div>
                    <b>{x.device.vehicleName}</b>
                    <small>{x.device.plateNumber || "بدون لوحة"}</small>
                  </div>
                </div>
              </td>
              <td>
                {VEHICLE_TYPE_LABELS[(x.device.vehicleType as VehicleType) ?? "CAR"] ??
                  x.device.vehicleType}
              </td>
              <td dir="ltr">{x.device.imei}</td>
              <td>{x.customer?.fullName ?? "—"}</td>
              <td>
                <Pill value={x.device.connectionState} />
              </td>
              <td>
                <Pill value={x.subscription?.status ?? "—"} />
              </td>
              <td>{formatDate(x.device.lastSeenAtMs)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <div className="row-actions">
                  {onSendSms && (
                    <button
                      className="icon-btn"
                      aria-label="إرسال رسالة التفعيل"
                      disabled={smsSendingId === x.device.id}
                      onClick={() => onSendSms(x.device.id)}
                    >
                      <Send size={15} />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    aria-label="التفاصيل"
                    onClick={() => onOpen(x)}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemCard({
  icon: Icon,
  title,
  ok,
  state
}: {
  icon: typeof Activity;
  title: string;
  ok: boolean;
  state: string;
}) {
  return (
    <div className="panel system-card">
      <div className={"system-card-icon " + (ok ? "good" : "bad")}>
        <Icon size={20} />
      </div>
      <div>
        <b>{title}</b>
        <small>{state}</small>
      </div>
      <span className={"status-dot " + (ok ? "good" : "bad")} />
    </div>
  );
}
