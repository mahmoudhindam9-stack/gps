import type {
  CustomerDetails,
  DeviceBundle,
  DeviceCommandLog,
  DeviceCommandType,
  DeviceProfile,
  DeviceShareLink,
  FleetEvent,
  FleetGeofence,
  FleetMileageSummary,
  FleetTelemetry,
  GitHubReleaseInfo,
  Health,
  RoutePoint,
  Session,
  SmsLog,
  User
} from "./types";

export const APP_VERSION = "1.1.0";
export const GITHUB_REPO = "mahmoudhindam9-stack/gps";
export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
const SESSION_KEY = "velotrack.web.session.v1";

function compareSemverClient(versionA: string, versionB: string): number {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = norm(versionA);
  const b = norm(versionB);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return 1;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return -1;
  }
  return 0;
}

export async function fetchGitHubReleaseDirect(
  autoUpdateEnabled = true
): Promise<GitHubReleaseInfo> {
  const checkedAtMs = Date.now();
  try {
    let res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" }
    });
    let rel: any = null;
    if (res.ok) {
      rel = await res.json();
    } else if (res.status === 404) {
      res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length > 0) rel = arr[0];
      }
    }
    if (!rel || !rel.tag_name) {
      return {
        currentVersion: APP_VERSION,
        repository: GITHUB_REPO,
        latestVersion: APP_VERSION,
        tagName: `v${APP_VERSION}`,
        releaseName: `VeloTrack GPS v${APP_VERSION}`,
        publishedAt: null,
        htmlUrl: `https://github.com/${GITHUB_REPO}/releases`,
        apkDownloadUrl: null,
        webBundleDownloadUrl: null,
        releaseNotes: "",
        updateAvailable: false,
        autoUpdateEnabled,
        checkedAtMs,
        status: "UP_TO_DATE"
      };
    }
    const tagName = String(rel.tag_name);
    const latestVersion = tagName.replace(/^v/i, "");
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const apk = assets.find((a: any) => String(a?.name ?? "").toLowerCase().endsWith(".apk"));
    const webAsset = assets.find((a: any) =>
      String(a?.name ?? "").toLowerCase().endsWith(".tar.gz")
    );
    const updateAvailable = compareSemverClient(latestVersion, APP_VERSION) > 0;
    return {
      currentVersion: APP_VERSION,
      repository: GITHUB_REPO,
      latestVersion,
      tagName,
      releaseName: String(rel.name || tagName),
      publishedAt: rel.published_at ?? null,
      htmlUrl: String(rel.html_url || `https://github.com/${GITHUB_REPO}/releases`),
      apkDownloadUrl: apk?.browser_download_url ?? null,
      webBundleDownloadUrl: webAsset?.browser_download_url ?? null,
      releaseNotes: String(rel.body ?? ""),
      updateAvailable,
      autoUpdateEnabled,
      checkedAtMs,
      status: updateAvailable ? "UPDATE_AVAILABLE" : "UP_TO_DATE"
    };
  } catch {
    return {
      currentVersion: APP_VERSION,
      repository: GITHUB_REPO,
      latestVersion: APP_VERSION,
      tagName: `v${APP_VERSION}`,
      releaseName: `VeloTrack GPS v${APP_VERSION}`,
      publishedAt: null,
      htmlUrl: `https://github.com/${GITHUB_REPO}/releases`,
      apkDownloadUrl: null,
      webBundleDownloadUrl: null,
      releaseNotes: "",
      updateAvailable: false,
      autoUpdateEnabled,
      checkedAtMs,
      status: "OFFLINE"
    };
  }
}

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
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { error: raw.slice(0, 160) };
    }
  }
  if (!response.ok) {
    const code = String(payload.error ?? payload.message ?? "REQUEST_FAILED");
    const messages: Record<string, string> = {
      INVALID_CREDENTIALS: "بيانات تسجيل الدخول غير صحيحة",
      AUTH_TOKEN_MISSING: "انتهت الجلسة، سجل الدخول مجددًا",
      PASSWORD_CHANGE_REQUIRED: "يجب تغيير كلمة المرور أولًا",
      ACCOUNT_DEACTIVATED: "الحساب موقوف",
      FORBIDDEN_ADMIN_ONLY: "هذه الصلاحية متاحة للمدير فقط",
      FORBIDDEN_DEVICE_ACCESS: "غير مصرح بالوصول إلى هذه المركبة",
      FORBIDDEN_COMMAND_ROLE: "هذا الأمر متاح لمدير النظام فقط",
      SUBSCRIPTION_EXPIRED: "الاشتراك منتهي",
      SUBSCRIPTION_SUSPENDED: "الاشتراك موقوف",
      API_URL_NOT_CONFIGURED: "عنوان الخادم غير مضبوط",
      SUPABASE_PRODUCTION_CONFIGURATION_INCOMPLETE: "إعدادات قاعدة البيانات غير مكتملة",
      TRACCAR_CONNECTION_CONFIGURATION_INCOMPLETE: "إعدادات Traccar غير مكتملة",
      PROFILE_NOT_VERIFIED_FOR_SMS: "ملف الجهاز غير معتمد بعد الاختبار الفعلي",
      IMEI_ALREADY_REGISTERED: "رقم IMEI مسجل بالفعل",
      DUPLICATE_IMEI: "رقم IMEI مسجل بالفعل",
      INVALID_IMEI_15_DIGITS: "رقم IMEI غير صحيح (15 رقمًا مع تحقق Luhn)",
      INVALID_IMEI: "رقم IMEI غير صحيح",
      USERNAME_ALREADY_EXISTS: "اسم المستخدم مسجل بالفعل",
      PHONE_ALREADY_EXISTS: "رقم الهاتف مسجل بالفعل",
      EMAIL_ALREADY_EXISTS: "البريد الإلكتروني مسجل بالفعل",
      USER_HAS_ASSIGNED_VEHICLES: "لا يمكن حذف عميل لديه مركبات مسندة قبل نقل ملكيتها",
      PRIMARY_ADMIN_CANNOT_BE_DELETED: "لا يمكن حذف حساب المدير الأساسي للنظام",
      PRIMARY_ADMIN_CANNOT_BE_DEACTIVATED: "لا يمكن إيقاف حساب المدير الأساسي للنظام",
      CANNOT_DELETE_SELF: "لا يمكن حذف الحساب الحالي",
      CANNOT_DEACTIVATE_SELF: "لا يمكن إيقاف الحساب الحالي",
      SENSITIVE_COMMAND_CONFIRMATION_REQUIRED: "يجب تأكيد الأمر الحساس قبل الإرسال",
      UNSUPPORTED_COMMAND_TYPE: "الأمر غير مدعوم لهذا الجهاز",
      CUSTOMER_NOT_FOUND: "العميل غير موجود",
      USER_NOT_FOUND: "المستخدم غير موجود",
      DEVICE_NOT_FOUND: "الجهاز غير موجود",
      INVALID_CUSTOMER_INPUT: "راجع بيانات العميل",
      INVALID_USER_INPUT: "راجع بيانات المستخدم",
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
    request<Session>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    }),
  me: (token: string) => request<User>("/api/v1/auth/me", {}, token),
  wsTicket: (token: string) =>
    request<{ ticket: string; expiresInSeconds: number }>(
      "/api/v1/auth/ws-ticket",
      { method: "POST" },
      token
    ),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    request<Session>(
      "/api/v1/auth/change-password",
      {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      },
      token
    ),
  devices: (token: string) => request<DeviceBundle[]>("/api/v1/devices", {}, token),
  deviceDetails: (token: string, deviceId: string) =>
    request<DeviceBundle>("/api/v1/devices/" + encodeURIComponent(deviceId), {}, token),
  updateVehicle: (token: string, deviceId: string, input: Record<string, unknown>) =>
    request<DeviceBundle>(
      "/api/v1/devices/" + encodeURIComponent(deviceId),
      { method: "PATCH", body: JSON.stringify(input) },
      token
    ),
  users: (token: string) => request<User[]>("/api/v1/users", {}, token),
  createUser: (token: string, input: Record<string, unknown>) =>
    request<User>("/api/v1/users", { method: "POST", body: JSON.stringify(input) }, token),
  createCustomer: (token: string, input: Record<string, unknown>) =>
    request<User>("/api/v1/admin/customers", { method: "POST", body: JSON.stringify(input) }, token),
  updateUser: (token: string, userId: string, input: Record<string, unknown>) =>
    request<User>(
      "/api/v1/users/" + encodeURIComponent(userId),
      { method: "PATCH", body: JSON.stringify(input) },
      token
    ),
  setUserStatus: (token: string, userId: string, isActive: boolean) =>
    request<User>(
      "/api/v1/users/" + encodeURIComponent(userId) + "/status",
      { method: "POST", body: JSON.stringify({ isActive }) },
      token
    ),
  deleteUser: (token: string, userId: string) =>
    request<{ id: string; deleted: boolean }>(
      "/api/v1/users/" + encodeURIComponent(userId),
      { method: "DELETE" },
      token
    ),
  customerDetails: (token: string, userId: string) =>
    request<CustomerDetails>("/api/v1/customers/" + encodeURIComponent(userId), {}, token),
  profiles: (token: string) => request<DeviceProfile[]>("/api/v1/profiles", {}, token),
  createProfile: (token: string, input: Record<string, unknown>) =>
    request<DeviceProfile>(
      "/api/v1/profiles",
      { method: "POST", body: JSON.stringify(input) },
      token
    ),
  verifyProfile: (token: string, profileId: string) =>
    request<DeviceProfile>(
      "/api/v1/admin/profiles/" + encodeURIComponent(profileId) + "/verify",
      { method: "POST" },
      token
    ),
  activateDevice: (token: string, input: Record<string, unknown>) =>
    request<DeviceBundle & { smsSkipped?: boolean; duplicatePrevented?: boolean }>(
      "/api/v1/admin/devices/activate",
      { method: "POST", body: JSON.stringify(input) },
      token
    ),
  sendActivationSms: (
    token: string,
    deviceId: string,
    idempotencyKey?: string,
    forceResend = false
  ) =>
    request<{
      deviceId: string;
      duplicatePrevented: boolean;
      activationStatus: string;
      smsLogs: SmsLog[];
    }>(
      "/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/send-activation-sms",
      {
        method: "POST",
        body: JSON.stringify({ idempotencyKey, forceResend })
      },
      token
    ),
  renew: (token: string, deviceId: string, planDuration: string) =>
    request(
      "/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/renew",
      {
        method: "POST",
        body: JSON.stringify({ planDuration })
      },
      token
    ),
  suspend: (token: string, deviceId: string, reason: string) =>
    request(
      "/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/suspend",
      {
        method: "POST",
        body: JSON.stringify({ reason })
      },
      token
    ),
  resume: (token: string, deviceId: string, reason: string) =>
    request(
      "/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/resume",
      {
        method: "POST",
        body: JSON.stringify({ reason })
      },
      token
    ),
  reassign: (token: string, deviceId: string, newCustomerId: string, reason: string) =>
    request(
      "/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/reassign",
      {
        method: "POST",
        body: JSON.stringify({ newCustomerId, reason })
      },
      token
    ),
  overrideActivation: (token: string, deviceId: string, auditReason: string) =>
    request(
      "/api/v1/admin/devices/" + encodeURIComponent(deviceId) + "/override-activate",
      {
        method: "POST",
        body: JSON.stringify({ auditReason })
      },
      token
    ),
  commandTypes: (token: string, deviceId: string) =>
    request<DeviceCommandType[]>(
      "/api/v1/devices/" + encodeURIComponent(deviceId) + "/commands/types",
      {},
      token
    ),
  commandHistory: (token: string, deviceId: string) =>
    request<DeviceCommandLog[]>(
      "/api/v1/devices/" + encodeURIComponent(deviceId) + "/commands",
      {},
      token
    ),
  sendCommand: (
    token: string,
    deviceId: string,
    input: {
      type: string;
      parameters?: Record<string, unknown>;
      confirmedSensitive?: boolean;
    }
  ) =>
    request<DeviceCommandLog>(
      "/api/v1/devices/" + encodeURIComponent(deviceId) + "/commands",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      token
    ),
  routeHistory: (token: string, deviceId: string, from: string, to: string) =>
    request<RoutePoint[]>(
      "/api/v1/devices/" +
        encodeURIComponent(deviceId) +
        "/history?from=" +
        encodeURIComponent(from) +
        "&to=" +
        encodeURIComponent(to),
      {},
      token
    ),

  fleetEvents: (token: string, from: string, to: string, deviceId?: string) => {
    const params = new URLSearchParams({ from, to });
    if (deviceId) params.set("deviceId", deviceId);
    return request<FleetEvent[]>("/api/v1/events?" + params.toString(), {}, token);
  },
  mileageSummary: (token: string, from: string, to: string, deviceId?: string) => {
    const params = new URLSearchParams({ from, to });
    if (deviceId) params.set("deviceId", deviceId);
    return request<FleetMileageSummary[]>("/api/v1/reports/summary?" + params.toString(), {}, token);
  },
  fleetTelemetry: (token: string, deviceId?: string) => {
    const params = new URLSearchParams();
    if (deviceId) params.set("deviceId", deviceId);
    const query = params.toString();
    return request<FleetTelemetry[]>("/api/v1/telemetry" + (query ? "?" + query : ""), {}, token);
  },
  geofences: (token: string) => request<FleetGeofence[]>("/api/v1/geofences", {}, token),
  createGeofence: (token: string, input: { name: string; description?: string; area: string; deviceIds: string[] }) =>
    request<FleetGeofence>("/api/v1/geofences", { method: "POST", body: JSON.stringify(input) }, token),
  deleteGeofence: (token: string, id: number) =>
    request<{ id: number; deleted: boolean }>("/api/v1/geofences/" + encodeURIComponent(String(id)), { method: "DELETE" }, token),
  createDeviceShare: (token: string, deviceId: string, expiresInHours: number) =>
    request<DeviceShareLink>("/api/v1/devices/" + encodeURIComponent(deviceId) + "/share", {
      method: "POST", body: JSON.stringify({ expiresInHours })
    }, token),
  syncTraccar: (token: string) => request("/api/v1/admin/traccar/sync", { method: "POST" }, token),
  checkUpdate: async (autoUpdateEnabled = true): Promise<GitHubReleaseInfo> => {
    try {
      return await request<GitHubReleaseInfo>("/api/v1/system/check-update", {
        method: "POST",
        body: JSON.stringify({ autoUpdateEnabled })
      });
    } catch {
      return fetchGitHubReleaseDirect(autoUpdateEnabled);
    }
  }
};

export function liveSocketUrl(tokenOrTicket: string, isTicket = false): string {
  const base = apiUrl("/ws/live");
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (isTicket) {
    url.searchParams.set("ticket", tokenOrTicket);
  } else {
    url.searchParams.set("token", tokenOrTicket);
  }
  return url.toString();
}

