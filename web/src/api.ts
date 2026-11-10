import type {
  DeviceBundle, DeviceProfile, Health, RoutePoint, Session, User
} from "./types";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
const SESSION_KEY = "velotrack.web.session.v1";

export function readSession(): Session | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value ? (JSON.parse(value) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
}

export function apiUrl(path: string) {
  if (!API_BASE) throw new Error("اضبط VITE_API_BASE_URL أولًا");
  return API_BASE + (path.startsWith("/") ? path : "/" + path);
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);

  const targetUrl = apiUrl(path);
  let response: Response;
  try {
    response = await fetch(targetUrl, { ...options, headers, cache: "no-store" });
  } catch {
    throw new Error("تعذر الاتصال بالخادم");
  }

  const raw = await response.text();
  let payload: any = {};
  if (raw) {
    try { payload = JSON.parse(raw); }
    catch { payload = { error: raw.slice(0, 160) }; }
  }
  if (!response.ok) {
    const code = String(payload.error ?? payload.message ?? "REQUEST_FAILED");
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "بيانات تسجيل الدخول غير صحيحة",
      AUTH_TOKEN_MISSING: "انتهت الجلسة، سجل الدخول مجددًا",
      PASSWORD_CHANGE_REQUIRED: "يجب تغيير كلمة المرور أولًا",
      FORBIDDEN_ADMIN_ONLY: "هذه الصلاحية متاحة للمدير فقط",
      SUBSCRIPTION_EXPIRED: "الاشتراك منتهي",
      API_URL_NOT_CONFIGURED: "عنوان الخادم غير مضبوط",
      SUPABASE_PRODUCTION_CONFIGURATION_INCOMPLETE: "إعدادات قاعدة البيانات غير مكتملة",
      TRACCAR_CONNECTION_CONFIGURATION_INCOMPLETE: "إعدادات Traccar غير مكتملة",
      PROFILE_NOT_VERIFIED_FOR_SMS: "ملف الجهاز غير معتمد بعد الاختبار الفعلي",
      DUPLICATE_IMEI: "رقم IMEI مسجل بالفعل",
      INVALID_IMEI: "رقم IMEI غير صحيح",
      CUSTOMER_NOT_FOUND: "العميل غير موجود",
      INVALID_CUSTOMER_INPUT: "راجع بيانات العميل",
      WEAK_NEW_PASSWORD: "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف",
      INVALID_PROFILE_COMMAND_POLICY: "الأمر غير مسموح به حسب سياسة الجهاز",
      DATABASE_UNAVAILABLE: "قاعدة البيانات غير متاحة"
    };
    throw new Error(messages[code] ?? code);
  }
  return payload as T;
}

export const api = {
  health: () => request<Health>("/api/v1/health"),
  login: (identifier: string, password: string) =>
    request<Session>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) }),
  me: (token: string) => request<User>("/api/v1/auth/me", {}, token),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<Session>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    }, token),
  devices: (token: string) => request<DeviceBundle[]>("/api/v1/devices", {}, token),
  users: (token: string) => request<User[]>("/api/v1/users", {}, token),
  profiles: (token: string) => request<DeviceProfile[]>("/api/v1/profiles", {}, token),
  createCustomer: (token: string, input: Record<string, unknown>) =>
    request<User>("/api/v1/admin/customers", { method: "POST", body: JSON.stringify(input) }, token),
  createProfile: (token: string, input: Record<string, unknown>) =>
    request<DeviceProfile>("/api/v1/profiles", { method: "POST", body: JSON.stringify(input) }, token),
  verifyProfile: (token: string, profileId: string) =>
    request<DeviceProfile>("/api/v1/admin/profiles/" + encodeURIComponent(profileId) + "/verify", { method: "POST" }, token),
  activateDevice: (token: string, input: Record<string, unknown>) =>
    request<{ device: unknown; subscription: unknown }>("/api/v1/admin/devices/activate", { method: "POST", body: JSON.stringify(input) }, token),
  renew: (token: string, deviceId: string, planDuration: string) =>
    request("/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/renew", {
      method: "POST", body: JSON.stringify({ planDuration })
    }, token),
  reassign: (token: string, deviceId: string, newCustomerId: string, reason: string) =>
    request("/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/reassign", {
      method: "POST", body: JSON.stringify({ newCustomerId, reason })
    }, token),
  overrideActivation: (token: string, deviceId: string, auditReason: string) =>
    request("/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/override-activate", {
      method: "POST", body: JSON.stringify({ auditReason })
    }, token),
  routeHistory: (token: string, deviceId: string, from: string, to: string) =>
    request<RoutePoint[]>("/api/v1/devices/" + encodeURIComponent(deviceId) + "/history?from=" +
      encodeURIComponent(from) + "&to=" + encodeURIComponent(to), {}, token),
  syncTraccar: (token: string) => request("/api/v1/admin/traccar/sync", { method: "POST" }, token)
};

export function liveSocketUrl(token: string): string {
  const base = apiUrl("/ws/live");
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}
