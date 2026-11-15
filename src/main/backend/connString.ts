import { ApiError } from './errors.ts';

/** Everything the app needs to know about a SQL Server connection. */
export interface ConnInfo {
  server: string;          // host name only
  port?: number;
  instance?: string;       // named instance (host\instance)
  database: string;
  integrated: boolean;     // Windows authentication
  user?: string;
  password?: string;
  trustServerCertificate: boolean;
  encrypt: boolean;
  connectTimeout: number;  // seconds
  commandTimeout: number;  // seconds
  appName?: string;
}

/** The keywords we understand, normalised (lower case, no spaces/underscores). */
const ALIASES: Record<string, string> = {
  datasource: 'server', server: 'server', address: 'server', addr: 'server', networkaddress: 'server',
  initialcatalog: 'database', database: 'database',
  userid: 'user', uid: 'user', user: 'user',
  password: 'password', pwd: 'password',
  integratedsecurity: 'integrated', trustedconnection: 'integrated',
  trustservercertificate: 'trust',
  encrypt: 'encrypt',
  connecttimeout: 'connectTimeout', connectiontimeout: 'connectTimeout', timeout: 'connectTimeout',
  commandtimeout: 'commandTimeout',
  applicationname: 'appName', app: 'appName',
};

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  switch (v.trim().toLowerCase()) {
    case 'true': case 'yes': case 'sspi': case 'mandatory': case 'strict': case '1': return true;
    case 'false': case 'no': case 'optional': case '0': return false;
    default: throw new ApiError(400, `Invalid connection string: '${v}' is not a valid boolean.`);
  }
}

/** Splits `key=value;key=value` honouring ' and " quoting (a doubled quote is a literal quote). */
function tokenize(cs: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const n = cs.length;
  while (i < n) {
    while (i < n && (cs[i] === ';' || /\s/.test(cs[i]))) i++;
    if (i >= n) break;
    const eq = cs.indexOf('=', i);
    if (eq < 0) throw new ApiError(400, `Invalid connection string: expected 'keyword=value' near '${cs.slice(i, i + 20)}'.`);
    const key = cs.slice(i, eq).trim().toLowerCase().replace(/[\s_]+/g, '');
    if (!key) throw new ApiError(400, 'Invalid connection string: empty keyword.');
    i = eq + 1;
    while (i < n && /\s/.test(cs[i])) i++;
    let value = '';
    if (cs[i] === '"' || cs[i] === "'") {
      const q = cs[i++];
      for (;;) {
        if (i >= n) throw new ApiError(400, 'Invalid connection string: unterminated quoted value.');
        if (cs[i] === q) {
          if (cs[i + 1] === q) { value += q; i += 2; continue; }
          i++;
          break;
        }
        value += cs[i++];
      }
      while (i < n && cs[i] !== ';') i++;
    } else {
      const end = cs.indexOf(';', i);
      value = cs.slice(i, end < 0 ? n : end).trim();
      i = end < 0 ? n : end;
    }
    out[ALIASES[key] ?? `x:${key}`] = value;
  }
  return out;
}

function parseServer(raw: string): Pick<ConnInfo, 'server' | 'port' | 'instance'> {
  let s = raw.trim().replace(/^(tcp|np|lpc):/i, '');
  let port: number | undefined;
  const comma = s.lastIndexOf(',');
  if (comma >= 0) {
    const p = Number(s.slice(comma + 1));
    if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new ApiError(400, `Invalid connection string: bad port in '${raw}'.`);
    port = p;
    s = s.slice(0, comma);
  }
  let instance: string | undefined;
  const slash = s.indexOf('\\');
  if (slash >= 0) { instance = s.slice(slash + 1) || undefined; s = s.slice(0, slash); }
  if (s === '.' || s.toLowerCase() === '(local)' || s === '') s = 'localhost';
  return { server: s, port, instance };
}

export function parseConnectionString(cs: string): ConnInfo {
  const t = tokenize(cs);
  if (!t.server) throw new ApiError(400, 'Invalid connection string: no Data Source / Server given.');
  const integrated = parseBool(t.integrated, false);
  const num = (v: string | undefined, d: number) => {
    if (v === undefined || v === '') return d;
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new ApiError(400, `Invalid connection string: '${v}' is not a valid number.`);
    return x;
  };
  return {
    ...parseServer(t.server),
    database: t.database ?? '',
    integrated,
    user: integrated ? undefined : t.user,
    password: integrated ? undefined : t.password,
    // Same defaults as Microsoft.Data.SqlClient 4+: encrypt on, certificate validated.
    trustServerCertificate: parseBool(t.trust, false),
    encrypt: parseBool(t.encrypt, true),
    connectTimeout: num(t.connectTimeout, 15),
    commandTimeout: num(t.commandTimeout, 30),
    appName: t.appName,
  };
}

function quote(v: string): string {
  return /[;'"=\s]/.test(v) || v === '' ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Canonical ADO.NET connection string. `maskPassword` replaces the password for display. */
export function buildConnectionString(c: ConnInfo, maskPassword = false): string {
  const parts: string[] = [];
  const server = c.server + (c.instance ? '\\' + c.instance : '') + (c.port ? ',' + c.port : '');
  parts.push(`Data Source=${quote(server)}`);
  if (c.database) parts.push(`Initial Catalog=${quote(c.database)}`);
  if (c.integrated) parts.push('Integrated Security=True');
  else {
    if (c.user) parts.push(`User ID=${quote(c.user)}`);
    if (c.password) parts.push(`Password=${maskPassword ? '********' : quote(c.password)}`);
  }
  parts.push(`Encrypt=${c.encrypt ? 'True' : 'False'}`);
  parts.push(`Trust Server Certificate=${c.trustServerCertificate ? 'True' : 'False'}`);
  if (c.connectTimeout !== 15) parts.push(`Connect Timeout=${c.connectTimeout}`);
  if (c.commandTimeout !== 30) parts.push(`Command Timeout=${c.commandTimeout}`);
  if (c.appName) parts.push(`Application Name=${quote(c.appName)}`);
  return parts.join(';');
}

export interface ConnectionSettings {
  connectionString?: string | null;
  server?: string | null;
  port?: number | null;
  database?: string | null;
  authType?: string | null;      // "windows" | "sql"
  user?: string | null;
  password?: string | null;
  trustServerCertificate?: boolean | null;
  encrypt?: boolean | null;
  createDatabase?: boolean;
  dbType?: string | null;
}

/** Builds the canonical connection info from either a raw connection string or the form fields. */
export function connInfoFromSettings(s: ConnectionSettings): ConnInfo {
  if (s.connectionString && s.connectionString.trim()) return parseConnectionString(s.connectionString);
  if (!s.server || !s.server.trim()) throw new ApiError(400, 'Server is required.');
  const sqlAuth = (s.authType ?? '').toLowerCase() === 'sql';
  if (sqlAuth && !(s.user && s.user.trim())) throw new ApiError(400, 'User is required for SQL authentication.');
  const server = parseServer(s.port && s.port > 0 ? `${s.server.trim()},${s.port}` : s.server.trim());
  return {
    ...server,
    database: s.database?.trim() ?? '',
    integrated: !sqlAuth,
    user: sqlAuth ? s.user! : undefined,
    password: sqlAuth ? (s.password ?? '') : undefined,
    trustServerCertificate: s.trustServerCertificate ?? true,
    encrypt: s.encrypt ?? false,
    connectTimeout: 15,
    commandTimeout: 30,
  };
}
