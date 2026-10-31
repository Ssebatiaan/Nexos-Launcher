// Cuentas premium: inicio de sesion con Microsoft (pagina oficial dentro del launcher, flujo con PKCE), la cadena
// Microsoft -> Xbox Live -> XSTS -> Minecraft, renovar la sesion y la skin oficial (API de Mojang).
// App de Azure "Nexos Launcher" aprobada por Mojang (docs/aprobacion-microsoft.md).
import { BrowserWindow, session } from "electron";
import { createHash, randomBytes } from "node:crypto";

export const CLIENT_ID = "bf95468d-9abf-41ad-b865-4d7ce7ab2d98";
const REDIRECT = "http://localhost";
const AUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE = "XboxLive.signin offline_access";
const MC = "https://api.minecraftservices.com";

/** Lo que hace falta guardar (cifrado) de una cuenta premium. */
export interface McSession {
  name: string;
  /** UUID sin guiones. */
  uuid: string;
  xuid: string;
  mcToken: string;
  /** Hasta cuando vale mcToken (ms). */
  mcExpires: number;
  refresh: string;
}

export interface McProfile {
  id: string;
  name: string;
  skins: Array<{ state: string; url: string; variant: string }>;
}

/** El usuario cerro la ventana de Microsoft: no es un error que haya que mostrar. */
export class LoginCancelled extends Error {
  constructor() {
    super("Inicio de sesión cancelado.");
  }
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Abre la pagina oficial de Microsoft; al terminar devuelve la sesion de Minecraft de esa cuenta. */
export async function loginInteractive(parent: BrowserWindow): Promise<McSession> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const url = `${AUTH}/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    prompt: "select_account",
  });

  const code = await new Promise<string>((ok, fail) => {
    // Sesion propia y sin guardar: cada inicio pide la cuenta (para poder anadir otra) y no se mezcla con nada
    const ses = session.fromPartition(`microsoft-${Date.now()}`);
    let done = false;
    const win = new BrowserWindow({
      parent,
      modal: true,
      width: 520,
      height: 700,
      title: "Iniciar sesión con Microsoft",
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    // Microsoft vuelve a http://localhost?code=...: se corta ahi (no hay nada escuchando) y se lee el codigo
    ses.webRequest.onBeforeRequest({ urls: ["http://localhost/*", "http://localhost/?*"] }, (details, callback) => {
      callback({ cancel: true });
      if (done) return;
      done = true;
      const params = new URL(details.url).searchParams;
      win.destroy();
      if (params.get("error")) {
        const reason = params.get("error_description") ?? params.get("error")!;
        fail(params.get("error") === "access_denied" ? new LoginCancelled() : new Error("Microsoft no dejó iniciar sesión: " + reason));
      } else if (params.get("state") !== state || !params.get("code")) {
        fail(new Error("Respuesta de Microsoft no válida. Prueba otra vez."));
      } else {
        ok(params.get("code")!);
      }
    });
    win.on("closed", () => {
      if (!done) {
        done = true;
        fail(new LoginCancelled());
      }
    });
    win.loadURL(url).catch(() => {
      /* la carga cortada en localhost tambien llega aqui */
    });
  });

  const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier });
  return minecraftSession(tokens.access_token, tokens.refresh_token);
}

/** Renueva la sesion con el token de refresco (dura meses). Si falla, hay que volver a iniciar sesion. */
export async function refreshSession(old: McSession): Promise<McSession> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: old.refresh });
  return minecraftSession(tokens.access_token, tokens.refresh_token ?? old.refresh);
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token: string }> {
  const res = await fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, ...params }),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok || !json.access_token) {
    throw new SessionExpired(json.error_description ?? `HTTP ${res.status}`);
  }
  return json as unknown as { access_token: string; refresh_token: string };
}

/** La sesion de Microsoft ya no vale (caducada o revocada): hay que iniciar sesion otra vez. */
export class SessionExpired extends Error {}

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
}

const XSTS_ERRORS: Record<string, string> = {
  "2148916233": "Esta cuenta de Microsoft no tiene perfil de Xbox. Entra una vez en xbox.com para crearlo y vuelve a intentarlo.",
  "2148916235": "Xbox Live no está disponible en el país de esta cuenta.",
  "2148916236": "Esta cuenta necesita verificar la edad en xbox.com antes de jugar.",
  "2148916237": "Esta cuenta necesita verificar la edad en xbox.com antes de jugar.",
  "2148916238": "Es una cuenta de menor de edad: un adulto tiene que añadirla a una familia de Microsoft para poder jugar.",
};

async function minecraftSession(msAccess: string, refresh: string): Promise<McSession> {
  const xbl = await postJson<{ Token: string; DisplayClaims: { xui: Array<{ uhs: string }> } }>(
    "https://user.auth.xboxlive.com/user/authenticate",
    { Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: `d=${msAccess}` }, RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT" },
  );
  if (xbl.status !== 200) throw new Error(`Xbox Live no respondió bien (HTTP ${xbl.status}). Prueba en un rato.`);
  const uhs = xbl.json.DisplayClaims.xui[0].uhs;

  const xsts = await postJson<{ Token: string; XErr?: number; DisplayClaims: { xui: Array<{ xid?: string }> } }>(
    "https://xsts.auth.xboxlive.com/xsts/authorize",
    { Properties: { SandboxId: "RETAIL", UserTokens: [xbl.json.Token] }, RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT" },
  );
  if (xsts.status !== 200) {
    throw new Error(XSTS_ERRORS[String(xsts.json.XErr)] ?? `Xbox Live rechazó la cuenta (código ${xsts.json.XErr ?? xsts.status}).`);
  }
  // xid (XUID) viene con otro RelyingParty; para Minecraft basta el de esta respuesta si lo trae
  const xuid = xsts.json.DisplayClaims.xui[0]?.xid ?? "";

  const mc = await postJson<{ access_token: string; expires_in: number }>(`${MC}/authentication/login_with_xbox`, {
    identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}`,
  });
  if (mc.status === 403) throw new Error("Mojang no acepta todavía este launcher (aprobación de la app). Avisa al admin.");
  if (mc.status !== 200) throw new Error(`Los servidores de Minecraft no respondieron (HTTP ${mc.status}). Prueba en un rato.`);

  const profile = await getProfile(mc.json.access_token);
  return {
    name: profile.name,
    uuid: profile.id,
    xuid,
    mcToken: mc.json.access_token,
    mcExpires: Date.now() + mc.json.expires_in * 1000,
    refresh,
  };
}

/** Perfil de Minecraft (nombre, UUID y skins). Sin perfil = la cuenta no tiene Minecraft Java. */
export async function getProfile(mcToken: string): Promise<McProfile> {
  const res = await fetch(`${MC}/minecraft/profile`, { headers: { Authorization: `Bearer ${mcToken}` } });
  if (res.status === 404) {
    throw new Error("Esta cuenta de Microsoft no tiene Minecraft: Java Edition. Si lo compraste hace poco, entra una vez con el launcher oficial para crear el perfil.");
  }
  if (res.status === 401) throw new SessionExpired("token caducado");
  if (!res.ok) throw new Error(`No se pudo leer el perfil de Minecraft (HTTP ${res.status}).`);
  return (await res.json()) as McProfile;
}

/** Cambia la skin oficial (la que se ve en todos los servidores). */
export async function uploadSkin(mcToken: string, png: Buffer, variant: "classic" | "slim"): Promise<void> {
  const form = new FormData();
  form.append("variant", variant);
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "skin.png");
  const res = await fetch(`${MC}/minecraft/profile/skins`, { method: "POST", headers: { Authorization: `Bearer ${mcToken}` }, body: form });
  if (res.status === 401) throw new SessionExpired("token caducado");
  if (res.status === 429) throw new Error("Has cambiado de skin muchas veces seguidas: espera un minuto y prueba otra vez.");
  if (!res.ok) throw new Error(`Mojang no aceptó la skin (HTTP ${res.status}).`);
}

/** La skin oficial actual (PNG y variante) o undefined si usa la de por defecto. */
export async function currentSkin(mcToken: string): Promise<{ png: Buffer; variant: "classic" | "slim" } | undefined> {
  const profile = await getProfile(mcToken);
  const active = profile.skins.find((s) => s.state === "ACTIVE");
  if (!active) return undefined;
  const res = await fetch(active.url.replace(/^http:/, "https:"));
  if (!res.ok) return undefined;
  return { png: Buffer.from(await res.arrayBuffer()), variant: active.variant.toLowerCase() === "slim" ? "slim" : "classic" };
}
