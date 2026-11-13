using System.Text.Json;
using JsonProcedure.Api.Models;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.Sqlite;

namespace JsonProcedure.Api.Services;

/// <summary>
/// SQLite-backed storage for everything the app remembers about "the user":
/// settings/profile, saved connections, procedure drafts, execution history,
/// saved parameter sets, favorites and the activity log. There is a single shared user.
/// </summary>
public class UserStore
{
    readonly string connectionString;
    readonly IDataProtector protector;
    public string FilePath { get; }

    public UserStore(IHostEnvironment env, IDataProtectionProvider dp)
    {
        FilePath = Path.Combine(env.ContentRootPath, "userdata.db");
        connectionString = new SqliteConnectionStringBuilder { DataSource = FilePath, DefaultTimeout = 15 }.ToString();
        protector = dp.CreateProtector("JsonProcedure.SavedConnections.v1");
        Init();
    }

    // ------------------------------------------------------------------ plumbing
    SqliteConnection Open()
    {
        var c = new SqliteConnection(connectionString);
        c.Open();
        return c;
    }

    static SqliteCommand Cmd(SqliteConnection c, string sql, params (string, object?)[] ps)
    {
        var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in ps) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        return cmd;
    }

    static string Now() => DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");

    static string? S(SqliteDataReader r, int i) => r.IsDBNull(i) ? null : r.GetString(i);

    static JsonElement? Json(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try { return JsonDocument.Parse(raw).RootElement.Clone(); } catch (JsonException) { return null; }
    }

    void Init()
    {
        using var c = Open();
        using (var pragma = Cmd(c, "PRAGMA journal_mode=WAL;")) pragma.ExecuteNonQuery();
        const string schema = """
            CREATE TABLE IF NOT EXISTS settings(
                key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);

            CREATE TABLE IF NOT EXISTS saved_connections(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                db_type TEXT NOT NULL DEFAULT 'sqlserver',
                server TEXT, port INTEGER, database TEXT, auth_type TEXT, user TEXT,
                password_enc TEXT, connection_string_enc TEXT,
                trust_cert INTEGER NOT NULL DEFAULT 1, encrypt INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

            CREATE TABLE IF NOT EXISTS drafts(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                schema_name TEXT NOT NULL DEFAULT '', proc_name TEXT NOT NULL DEFAULT '',
                script TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(schema_name, proc_name));

            CREATE TABLE IF NOT EXISTS executions(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                schema_name TEXT NOT NULL, proc_name TEXT NOT NULL,
                db_type TEXT NOT NULL, database TEXT,
                parameters_json TEXT, status TEXT NOT NULL, error TEXT,
                elapsed_ms INTEGER NOT NULL DEFAULT 0, rows_affected INTEGER NOT NULL DEFAULT 0,
                return_value INTEGER, result_json TEXT, created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_exec_proc ON executions(schema_name, proc_name, id DESC);

            CREATE TABLE IF NOT EXISTS parameter_sets(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                schema_name TEXT NOT NULL, proc_name TEXT NOT NULL,
                label TEXT NOT NULL, parameters_json TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ix_pset_proc ON parameter_sets(schema_name, proc_name);

            CREATE TABLE IF NOT EXISTS favorites(
                kind TEXT NOT NULL, schema_name TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL,
                PRIMARY KEY(kind, schema_name, name));

            CREATE TABLE IF NOT EXISTS logs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL, level TEXT NOT NULL, level_no INTEGER NOT NULL,
                category TEXT NOT NULL, message TEXT NOT NULL, details_json TEXT,
                duration_ms INTEGER, status_code INTEGER);
            CREATE INDEX IF NOT EXISTS ix_logs_ts ON logs(id DESC);
            """;
        using var cmd = Cmd(c, schema);
        cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------------------ settings
    public Dictionary<string, JsonElement> GetSettings()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT key, value FROM settings");
        using var r = cmd.ExecuteReader();
        var d = new Dictionary<string, JsonElement>();
        while (r.Read()) if (Json(r.GetString(1)) is { } v) d[r.GetString(0)] = v;
        return d;
    }

    /// <summary>Merges the given keys into the stored settings. A JSON null removes the key.</summary>
    public Dictionary<string, JsonElement> PutSettings(Dictionary<string, JsonElement> values)
    {
        if (values.Count > 100) throw new ApiException(400, "Too many settings keys.");
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var (k, v) in values)
        {
            if (string.IsNullOrWhiteSpace(k) || k.Length > 100) throw new ApiException(400, "Invalid settings key.");
            var raw = v.GetRawText();
            if (raw.Length > 200_000) throw new ApiException(400, $"Setting '{k}' is too large.");
            if (v.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                using var del = Cmd(c, "DELETE FROM settings WHERE key=$k", ("$k", k));
                del.Transaction = tx; del.ExecuteNonQuery();
                continue;
            }
            using var up = Cmd(c,
                "INSERT INTO settings(key,value,updated_at) VALUES($k,$v,$t) " +
                "ON CONFLICT(key) DO UPDATE SET value=$v, updated_at=$t",
                ("$k", k), ("$v", raw), ("$t", Now()));
            up.Transaction = tx; up.ExecuteNonQuery();
        }
        tx.Commit();
        return GetSettings();
    }

    // ------------------------------------------------------------------ saved connections
    const string ConnCols =
        "id,name,db_type,server,port,database,auth_type,user,password_enc,connection_string_enc,trust_cert,encrypt,created_at,updated_at";

    static SavedConnection ReadConn(SqliteDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetString(2), S(r, 3), r.IsDBNull(4) ? null : r.GetInt32(4), S(r, 5),
        S(r, 6), S(r, 7), !r.IsDBNull(8), !r.IsDBNull(9), r.GetInt32(10) == 1, r.GetInt32(11) == 1,
        r.GetString(12), r.GetString(13));

    public List<SavedConnection> ListConnections()
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {ConnCols} FROM saved_connections ORDER BY name");
        using var r = cmd.ExecuteReader();
        var list = new List<SavedConnection>();
        while (r.Read()) list.Add(ReadConn(r));
        return list;
    }

    public SavedConnection GetConnection(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {ConnCols} FROM saved_connections WHERE id=$id", ("$id", id));
        using var r = cmd.ExecuteReader();
        return r.Read() ? ReadConn(r) : throw new ApiException(404, "Saved connection not found.");
    }

    public SavedConnection SaveConnection(SaveConnectionRequest q)
    {
        var name = q.Name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 100) throw new ApiException(400, "A connection name (max 100 chars) is required.");
        var type = string.IsNullOrWhiteSpace(q.DbType) ? "sqlserver" : q.DbType.Trim().ToLowerInvariant();
        var hasCs = !string.IsNullOrWhiteSpace(q.ConnectionString);
        using var c = Open();
        long? existing;
        using (var find = Cmd(c, "SELECT id FROM saved_connections WHERE name=$n", ("$n", name)))
            existing = find.ExecuteScalar() as long?;

        var now = Now();
        if (existing is null)
        {
            using var ins = Cmd(c,
                "INSERT INTO saved_connections(name,db_type,server,port,database,auth_type,user,password_enc,connection_string_enc,trust_cert,encrypt,created_at,updated_at) " +
                "VALUES($n,$t,$s,$p,$d,$a,$u,$pw,$cs,$tc,$e,$now,$now); SELECT last_insert_rowid();",
                ("$n", name), ("$t", type), ("$s", hasCs ? null : q.Server?.Trim()), ("$p", hasCs ? null : q.Port),
                ("$d", hasCs ? null : q.Database?.Trim()), ("$a", q.AuthType), ("$u", q.User),
                ("$pw", string.IsNullOrEmpty(q.Password) ? null : protector.Protect(q.Password)),
                ("$cs", hasCs ? protector.Protect(q.ConnectionString!) : null),
                ("$tc", (q.TrustServerCertificate ?? true) ? 1 : 0), ("$e", (q.Encrypt ?? false) ? 1 : 0), ("$now", now));
            return GetConnection((long)ins.ExecuteScalar()!);
        }

        // Update: secrets that are not supplied keep their stored value.
        using var upd = Cmd(c,
            "UPDATE saved_connections SET db_type=$t, server=$s, port=$p, database=$d, auth_type=$a, user=$u, " +
            "password_enc=COALESCE($pw, CASE WHEN $clearpw=1 THEN NULL ELSE password_enc END), " +
            "connection_string_enc=CASE WHEN $form=1 THEN NULL ELSE COALESCE($cs, connection_string_enc) END, " +
            "trust_cert=$tc, encrypt=$e, updated_at=$now WHERE id=$id",
            ("$id", existing), ("$t", type), ("$s", hasCs ? null : q.Server?.Trim()), ("$p", hasCs ? null : q.Port),
            ("$d", hasCs ? null : q.Database?.Trim()), ("$a", q.AuthType), ("$u", q.User),
            ("$pw", string.IsNullOrEmpty(q.Password) ? null : protector.Protect(q.Password)),
            ("$clearpw", string.Equals(q.AuthType, "windows", StringComparison.OrdinalIgnoreCase) ? 1 : 0),
            ("$cs", hasCs ? protector.Protect(q.ConnectionString!) : null),
            ("$form", !hasCs && !string.IsNullOrWhiteSpace(q.Server) ? 1 : 0),
            ("$tc", (q.TrustServerCertificate ?? true) ? 1 : 0), ("$e", (q.Encrypt ?? false) ? 1 : 0), ("$now", now));
        upd.ExecuteNonQuery();
        return GetConnection(existing.Value);
    }

    /// <summary>Returns the stored connection with secrets decrypted, for applying it. Never expose the result.</summary>
    public ConnectionSettings GetConnectionSettings(long id, bool createDatabase)
    {
        using var c = Open();
        using var cmd = Cmd(c, $"SELECT {ConnCols} FROM saved_connections WHERE id=$id", ("$id", id));
        using var r = cmd.ExecuteReader();
        if (!r.Read()) throw new ApiException(404, "Saved connection not found.");
        string? pw = null, cs = null;
        try
        {
            if (!r.IsDBNull(8)) pw = protector.Unprotect(r.GetString(8));
            if (!r.IsDBNull(9)) cs = protector.Unprotect(r.GetString(9));
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            throw new ApiException(409, "The stored credentials can no longer be decrypted (the encryption keys were lost). Re-enter and save the connection again.");
        }
        return new ConnectionSettings(
            cs, S(r, 3), r.IsDBNull(4) ? null : r.GetInt32(4), S(r, 5), S(r, 6), S(r, 7), pw,
            r.GetInt32(10) == 1, r.GetInt32(11) == 1, createDatabase, r.GetString(2));
    }

    public void DeleteConnection(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM saved_connections WHERE id=$id", ("$id", id));
        if (cmd.ExecuteNonQuery() == 0) throw new ApiException(404, "Saved connection not found.");
    }

    // ------------------------------------------------------------------ drafts
    public List<Draft> ListDrafts(string? schema, string? name, bool exact)
    {
        using var c = Open();
        using var cmd = exact
            ? Cmd(c, "SELECT id,schema_name,proc_name,script,updated_at FROM drafts WHERE schema_name=$s AND proc_name=$n",
                ("$s", schema ?? ""), ("$n", name ?? ""))
            : Cmd(c, "SELECT id,schema_name,proc_name,script,updated_at FROM drafts ORDER BY updated_at DESC");
        using var r = cmd.ExecuteReader();
        var list = new List<Draft>();
        while (r.Read())
            list.Add(new(r.GetInt64(0), r.GetString(1) is { Length: > 0 } s ? s : null,
                r.GetString(2) is { Length: > 0 } n ? n : null, r.GetString(3), r.GetString(4)));
        return list;
    }

    public Draft SaveDraft(SaveDraftRequest q)
    {
        if (q.Script is null) throw new ApiException(400, "Script is required.");
        if (q.Script.Length > 2_000_000) throw new ApiException(400, "Script is too large.");
        using var c = Open();
        using var cmd = Cmd(c,
            "INSERT INTO drafts(schema_name,proc_name,script,updated_at) VALUES($s,$n,$sc,$t) " +
            "ON CONFLICT(schema_name,proc_name) DO UPDATE SET script=$sc, updated_at=$t; " +
            "SELECT id FROM drafts WHERE schema_name=$s AND proc_name=$n",
            ("$s", q.Schema ?? ""), ("$n", q.Name ?? ""), ("$sc", q.Script), ("$t", Now()));
        var id = (long)cmd.ExecuteScalar()!;
        return new(id, q.Schema, q.Name, q.Script, Now());
    }

    public void DeleteDraft(string? schema, string? name)
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM drafts WHERE schema_name=$s AND proc_name=$n", ("$s", schema ?? ""), ("$n", name ?? ""));
        cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------------------ execution history
    const int HistoryKeep = 2000;

    public void AddExecution(
        string schema, string name, string dbType, string? database, Dictionary<string, JsonElement>? parameters,
        string status, string? error, long elapsedMs, int rowsAffected, int? returnValue, object? result)
    {
        try
        {
            using var c = Open();
            using (var cmd = Cmd(c,
                "INSERT INTO executions(schema_name,proc_name,db_type,database,parameters_json,status,error,elapsed_ms,rows_affected,return_value,result_json,created_at) " +
                "VALUES($s,$n,$t,$d,$p,$st,$e,$ms,$ra,$rv,$res,$now)",
                ("$s", schema), ("$n", name), ("$t", dbType), ("$d", database),
                ("$p", parameters is null ? null : JsonSerializer.Serialize(parameters)),
                ("$st", status), ("$e", error), ("$ms", elapsedMs), ("$ra", rowsAffected), ("$rv", returnValue),
                ("$res", result is null ? null : JsonSerializer.Serialize(result)), ("$now", Now())))
                cmd.ExecuteNonQuery();
            using var prune = Cmd(c, "DELETE FROM executions WHERE id <= (SELECT MAX(id) FROM executions) - $keep", ("$keep", HistoryKeep));
            prune.ExecuteNonQuery();
        }
        catch (SqliteException) { /* history is best effort and must never break an execution */ }
    }

    public List<ExecutionRecordSummary> ListExecutions(string? schema, string? name, int limit, long? before)
    {
        limit = Math.Clamp(limit, 1, 500);
        using var c = Open();
        using var cmd = Cmd(c,
            "SELECT id,schema_name,proc_name,db_type,database,status,error,elapsed_ms,rows_affected,return_value,created_at FROM executions " +
            "WHERE ($s IS NULL OR schema_name=$s) AND ($n IS NULL OR proc_name=$n) AND ($b IS NULL OR id<$b) ORDER BY id DESC LIMIT $l",
            ("$s", schema), ("$n", name), ("$b", before), ("$l", limit));
        using var r = cmd.ExecuteReader();
        var list = new List<ExecutionRecordSummary>();
        while (r.Read())
            list.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), S(r, 4), r.GetString(5), S(r, 6),
                r.GetInt64(7), r.GetInt32(8), r.IsDBNull(9) ? null : r.GetInt32(9), r.GetString(10)));
        return list;
    }

    public ExecutionRecord GetExecution(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c,
            "SELECT id,schema_name,proc_name,db_type,database,status,error,elapsed_ms,rows_affected,return_value,created_at,parameters_json,result_json " +
            "FROM executions WHERE id=$id", ("$id", id));
        using var r = cmd.ExecuteReader();
        if (!r.Read()) throw new ApiException(404, "History entry not found.");
        return new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), S(r, 4), r.GetString(5), S(r, 6),
            r.GetInt64(7), r.GetInt32(8), r.IsDBNull(9) ? null : r.GetInt32(9), r.GetString(10), Json(S(r, 11)), Json(S(r, 12)));
    }

    public int ClearExecutions(string? schema, string? name)
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM executions WHERE ($s IS NULL OR schema_name=$s) AND ($n IS NULL OR proc_name=$n)",
            ("$s", schema), ("$n", name));
        return cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------------------ parameter sets
    public List<ParameterSet> ListParameterSets(string? schema, string? name)
    {
        using var c = Open();
        using var cmd = Cmd(c,
            "SELECT id,schema_name,proc_name,label,parameters_json,created_at FROM parameter_sets " +
            "WHERE ($s IS NULL OR schema_name=$s) AND ($n IS NULL OR proc_name=$n) ORDER BY label",
            ("$s", schema), ("$n", name));
        using var r = cmd.ExecuteReader();
        var list = new List<ParameterSet>();
        while (r.Read())
            list.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3),
                Json(r.GetString(4)) ?? JsonDocument.Parse("{}").RootElement.Clone(), r.GetString(5)));
        return list;
    }

    public ParameterSet SaveParameterSet(SaveParameterSetRequest q)
    {
        var label = q.Label?.Trim();
        if (string.IsNullOrEmpty(label) || label.Length > 100) throw new ApiException(400, "A label (max 100 chars) is required.");
        if (string.IsNullOrWhiteSpace(q.Schema) || string.IsNullOrWhiteSpace(q.Name)) throw new ApiException(400, "Schema and name are required.");
        if (q.Parameters.ValueKind != JsonValueKind.Object) throw new ApiException(400, "Parameters must be a JSON object.");
        using var c = Open();
        using var cmd = Cmd(c,
            "INSERT INTO parameter_sets(schema_name,proc_name,label,parameters_json,created_at) VALUES($s,$n,$l,$p,$t); SELECT last_insert_rowid();",
            ("$s", q.Schema), ("$n", q.Name), ("$l", label), ("$p", q.Parameters.GetRawText()), ("$t", Now()));
        var id = (long)cmd.ExecuteScalar()!;
        return new(id, q.Schema, q.Name, label, q.Parameters.Clone(), Now());
    }

    public void DeleteParameterSet(long id)
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM parameter_sets WHERE id=$id", ("$id", id));
        if (cmd.ExecuteNonQuery() == 0) throw new ApiException(404, "Parameter set not found.");
    }

    // ------------------------------------------------------------------ favorites
    static string Kind(string? k) =>
        k?.ToLowerInvariant() is "procedure" or "table" ? k.ToLowerInvariant() : throw new ApiException(400, "kind must be 'procedure' or 'table'.");

    public List<Favorite> ListFavorites()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT kind,schema_name,name,created_at FROM favorites ORDER BY kind, schema_name, name");
        using var r = cmd.ExecuteReader();
        var list = new List<Favorite>();
        while (r.Read()) list.Add(new(r.GetString(0), r.GetString(1), r.GetString(2), r.GetString(3)));
        return list;
    }

    public void AddFavorite(FavoriteRequest q)
    {
        if (string.IsNullOrWhiteSpace(q.Schema) || string.IsNullOrWhiteSpace(q.Name)) throw new ApiException(400, "Schema and name are required.");
        using var c = Open();
        using var cmd = Cmd(c, "INSERT OR IGNORE INTO favorites(kind,schema_name,name,created_at) VALUES($k,$s,$n,$t)",
            ("$k", Kind(q.Kind)), ("$s", q.Schema), ("$n", q.Name), ("$t", Now()));
        cmd.ExecuteNonQuery();
    }

    public void RemoveFavorite(string kind, string schema, string name)
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM favorites WHERE kind=$k AND schema_name=$s AND name=$n",
            ("$k", Kind(kind)), ("$s", schema), ("$n", name));
        cmd.ExecuteNonQuery();
    }

    // ------------------------------------------------------------------ logs
    public void WriteLogs(IReadOnlyList<LogRow> rows)
    {
        if (rows.Count == 0) return;
        using var c = Open();
        using var tx = c.BeginTransaction();
        foreach (var l in rows)
        {
            using var cmd = Cmd(c,
                "INSERT INTO logs(ts,level,level_no,category,message,details_json,duration_ms,status_code) VALUES($ts,$lv,$ln,$c,$m,$d,$ms,$sc)",
                ("$ts", l.Ts), ("$lv", l.Level), ("$ln", l.LevelNo), ("$c", l.Category), ("$m", l.Message),
                ("$d", l.DetailsJson), ("$ms", l.DurationMs), ("$sc", l.StatusCode));
            cmd.Transaction = tx; cmd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    public LogPage QueryLogs(string? minLevel, string? category, string? q, string? from, string? to, long? before, int limit)
    {
        limit = Math.Clamp(limit, 1, 500);
        var min = LogSink.LevelNo(minLevel);
        using var c = Open();
        using var cmd = Cmd(c,
            "SELECT id,ts,level,category,message,details_json,duration_ms,status_code FROM logs " +
            "WHERE level_no>=$min AND ($cat IS NULL OR category=$cat) AND ($q IS NULL OR message LIKE '%'||$q||'%' ESCAPE '\\' OR details_json LIKE '%'||$q||'%' ESCAPE '\\') " +
            "AND ($from IS NULL OR ts>=$from) AND ($to IS NULL OR ts<=$to) AND ($b IS NULL OR id<$b) ORDER BY id DESC LIMIT $l",
            ("$min", min), ("$cat", string.IsNullOrWhiteSpace(category) ? null : category),
            ("$q", string.IsNullOrWhiteSpace(q) ? null : q.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_")),
            ("$from", string.IsNullOrWhiteSpace(from) ? null : from), ("$to", string.IsNullOrWhiteSpace(to) ? null : to),
            ("$b", before), ("$l", limit + 1));
        using var r = cmd.ExecuteReader();
        var items = new List<LogEntry>();
        while (r.Read())
            items.Add(new(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), Json(S(r, 5)),
                r.IsDBNull(6) ? null : r.GetInt64(6), r.IsDBNull(7) ? null : r.GetInt32(7)));
        long? next = null;
        if (items.Count > limit) { items.RemoveAt(items.Count - 1); next = items[^1].Id; }
        return new(items, next);
    }

    public List<string> LogCategories()
    {
        using var c = Open();
        using var cmd = Cmd(c, "SELECT DISTINCT category FROM logs ORDER BY category");
        using var r = cmd.ExecuteReader();
        var list = new List<string>();
        while (r.Read()) list.Add(r.GetString(0));
        return list;
    }

    public int ClearLogs()
    {
        using var c = Open();
        using var cmd = Cmd(c, "DELETE FROM logs");
        return cmd.ExecuteNonQuery();
    }

    /// <summary>Keeps the newest 10,000 log rows and nothing older than 30 days.</summary>
    public void PruneLogs()
    {
        using var c = Open();
        using var cmd = Cmd(c,
            "DELETE FROM logs WHERE ts < $cut OR id <= (SELECT COALESCE(MAX(id),0) FROM logs) - 10000",
            ("$cut", DateTime.UtcNow.AddDays(-30).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")));
        cmd.ExecuteNonQuery();
    }
}
