import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;

export const STORAGE_KEYS = {
  ACCESS: "sm_access_token",
  REFRESH: "sm_refresh_token",
  EXPIRES_AT: "sm_expires_at",
  USER_ID: "sm_user_id",
  DISPLAY_NAME: "sm_display_name",
  PROFILE_IMAGE: "sm_profile_image",
  PRODUCT: "sm_product",
};

export type StoredAuth = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  display_name: string;
  profile_image: string;
  product: string;
};

export async function saveAuth(a: StoredAuth) {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.ACCESS, a.access_token),
    AsyncStorage.setItem(STORAGE_KEYS.REFRESH, a.refresh_token),
    AsyncStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(a.expires_at)),
    AsyncStorage.setItem(STORAGE_KEYS.USER_ID, a.user_id),
    AsyncStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, a.display_name),
    AsyncStorage.setItem(STORAGE_KEYS.PROFILE_IMAGE, a.profile_image),
    AsyncStorage.setItem(STORAGE_KEYS.PRODUCT, a.product),
  ]);
}

export async function loadAuth(): Promise<StoredAuth | null> {
  const [access, refresh, expires, uid, name, img, product] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.ACCESS),
    AsyncStorage.getItem(STORAGE_KEYS.REFRESH),
    AsyncStorage.getItem(STORAGE_KEYS.EXPIRES_AT),
    AsyncStorage.getItem(STORAGE_KEYS.USER_ID),
    AsyncStorage.getItem(STORAGE_KEYS.DISPLAY_NAME),
    AsyncStorage.getItem(STORAGE_KEYS.PROFILE_IMAGE),
    AsyncStorage.getItem(STORAGE_KEYS.PRODUCT),
  ]);
  if (!access || !refresh || !uid) return null;
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: Number(expires || "0"),
    user_id: uid,
    display_name: name || uid,
    profile_image: img || "",
    product: product || "free",
  };
}

export async function clearAuth() {
  await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
}

async function ensureFreshToken(auth: StoredAuth): Promise<string> {
  if (auth.expires_at - Date.now() > 60_000) return auth.access_token;
  const res = await fetch(`${BACKEND_URL}/api/spotify/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  if (!res.ok) throw new Error("refresh failed");
  const data = await res.json();
  auth.access_token = data.access_token;
  auth.refresh_token = data.refresh_token || auth.refresh_token;
  auth.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
  await saveAuth(auth);
  return auth.access_token;
}

export async function api<T = any>(path: string, options: RequestInit = {}, auth?: StoredAuth | null): Promise<T> {
  const url = `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as any) };
  if (auth) {
    await ensureFreshToken(auth);
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export async function getLoginUrl(opts: { mobile_redirect?: string; popup?: boolean } = {}): Promise<string> {
  const params = new URLSearchParams();
  if (opts.mobile_redirect) params.set("mobile_redirect", opts.mobile_redirect);
  if (opts.popup) params.set("popup", "1");
  const qs = params.toString();
  const data = await api<{ auth_url: string }>(`/api/spotify/login${qs ? `?${qs}` : ""}`);
  return data.auth_url;
}

export async function getCurrentlyPlaying(auth: StoredAuth) {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/currently-playing?access_token=${encodeURIComponent(t)}`);
}

export async function getDevices(auth: StoredAuth) {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/devices?access_token=${encodeURIComponent(t)}`);
}

export async function playerAction(
  action: "play" | "pause" | "next" | "previous" | "seek",
  auth: StoredAuth,
  extra: { track_uri?: string; position_ms?: number; device_id?: string } = {}
) {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/${action}`, {
    method: "POST",
    body: JSON.stringify({ access_token: t, ...extra }),
  });
}

export async function getActiveUsers() {
  return api<{ users: any[] }>("/api/users/active");
}

export async function searchTracks(auth: StoredAuth, q: string): Promise<any> {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/search?q=${encodeURIComponent(q)}&access_token=${encodeURIComponent(t)}`);
}

export async function addToQueue(auth: StoredAuth, trackUri: string, deviceId?: string) {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/queue`, {
    method: "POST",
    body: JSON.stringify({ access_token: t, track_uri: trackUri, device_id: deviceId }),
  });
}

export async function getQueue(auth: StoredAuth): Promise<any> {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/queue?access_token=${encodeURIComponent(t)}`);
}

export async function setRepeat(auth: StoredAuth, state: "off" | "track" | "context") {
  const t = await ensureFreshToken(auth);
  return api(`/api/spotify/repeat`, {
    method: "POST",
    body: JSON.stringify({ access_token: t, state }),
  });
}

export { BACKEND_URL };
