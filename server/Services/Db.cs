using System.Text.Json;
using System.Text.RegularExpressions;
using JsonProcedure.Api.Models;
using Microsoft.Data.SqlClient;

namespace JsonProcedure.Api.Services;

public record ConnectionSettings(
    string? ConnectionString,
    string? Server,
    int? Port,
    string? Database,
    string? AuthType,          // "windows" | "sql"
    string? User,
    string? Password,
    bool? TrustServerCertificate,
    bool? Encrypt,
    bool CreateDatabase = false,
    string? DbType = null);

public record ConnectionStatus(
    bool Connected, string? Error, string? Server, string? Database, string AuthType,
    string? User, bool HasPassword, bool TrustServerCertificate, bool Encrypt, string ConnectionString);

public class Db
{
    readonly string overridePath;
    readonly ILogger<Db> logger;
    string current;

    public Db(IConfiguration config, IHostEnvironment env, ILogger<Db> logger)
    {
        this.logger = logger;
        overridePath = Path.Combine(env.ContentRootPath, "connection.local.json");
        // Optional: ConnectionStrings:DefaultConnection (config/env) is only a fallback;
        // the normal way to connect is the Connection page in the UI.
        current = config.GetConnectionString("DefaultConnection") ?? "";
        // A connection saved from the UI wins over appsettings.json.
        try
        {
            if (File.Exists(overridePath))
            {
                var saved = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(overridePath));
                if (saved?.GetValueOrDefault("connectionString") is { Length: > 0 } cs) current = cs;
            }
        }
        catch (Exception ex) { logger.LogWarning(ex, "Could not read {File}", overridePath); }
    }

    public string ConnectionString => current;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(current);

    public async Task<SqlConnection> OpenAsync(CancellationToken ct = default)
    {
        if (!IsConfigured)
            throw new ApiException(503, "No database connection is configured yet. Open the Connection page first.");
        var conn = new SqlConnection(current);
        try { await conn.OpenAsync(ct); }
        catch (SqlException ex) when (ex.Number == 4060)
        {
            await conn.DisposeAsync();
            throw new ApiException(503, $"Database '{new SqlConnectionStringBuilder(current).InitialCatalog}' does not exist. Open the Connection page and tick 'Create database if missing'.");
        }
        catch (SqlException ex)
        {
            await conn.DisposeAsync();
            throw new ApiException(503, "Cannot connect to the database: " + ex.Message);
        }
        return conn;
    }

    // ---- connection management ---------------------------------------------
    public static string BuildConnectionString(ConnectionSettings s)
    {
        if (!string.IsNullOrWhiteSpace(s.ConnectionString))
        {
            try { return new SqlConnectionStringBuilder(s.ConnectionString).ConnectionString; }
            catch (ArgumentException ex) { throw new ApiException(400, "Invalid connection string: " + ex.Message); }
        }
        if (string.IsNullOrWhiteSpace(s.Server)) throw new ApiException(400, "Server is required.");
        var b = new SqlConnectionStringBuilder
        {
            DataSource = s.Port is > 0 ? $"{s.Server.Trim()},{s.Port}" : s.Server.Trim(),
            InitialCatalog = s.Database?.Trim() ?? "",
            TrustServerCertificate = s.TrustServerCertificate ?? true,
            Encrypt = s.Encrypt ?? false,
        };
        if (string.Equals(s.AuthType, "sql", StringComparison.OrdinalIgnoreCase))
        {
            if (string.IsNullOrWhiteSpace(s.User)) throw new ApiException(400, "User is required for SQL authentication.");
            b.UserID = s.User; b.Password = s.Password ?? "";
        }
        else b.IntegratedSecurity = true;
        return b.ConnectionString;
    }

    /// <summary>Checks the server (via master) and whether the database exists.</summary>
    public async Task<(bool serverOk, bool dbExists, string? error)> TestAsync(string connectionString)
    {
        var b = new SqlConnectionStringBuilder(connectionString);
        var dbName = b.InitialCatalog;
        b.InitialCatalog = "master";
        b.ConnectTimeout = Math.Min(b.ConnectTimeout, 10);
        try
        {
            await using var conn = new SqlConnection(b.ConnectionString);
            await conn.OpenAsync();
            if (string.IsNullOrWhiteSpace(dbName)) return (true, false, null);
            await using var cmd = new SqlCommand("SELECT DB_ID(@n)", conn);
            cmd.Parameters.AddWithValue("@n", dbName);
            return (true, await cmd.ExecuteScalarAsync() is not (null or DBNull), null);
        }
        catch (SqlException ex) { return (false, false, ex.Message); }
    }

    public async Task CreateDatabaseAsync(string connectionString)
    {
        var b = new SqlConnectionStringBuilder(connectionString);
        var dbName = b.InitialCatalog;
        if (string.IsNullOrWhiteSpace(dbName)) throw new ApiException(400, "Database name is required.");
        b.InitialCatalog = "master";
        await using var conn = new SqlConnection(b.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "IF DB_ID(@n) IS NULL BEGIN DECLARE @sql nvarchar(max) = 'CREATE DATABASE ' + QUOTENAME(@n); EXEC(@sql); END";
        cmd.Parameters.AddWithValue("@n", dbName);
        await cmd.ExecuteNonQueryAsync();
        logger.LogInformation("Database '{Db}' is ready.", dbName);
    }

    /// <summary>Tests, optionally creates the database, then switches the app to this connection and saves it.</summary>
    public async Task ApplyAsync(ConnectionSettings s)
    {
        var cs = BuildConnectionString(s);
        var (ok, exists, err) = await TestAsync(cs);
        if (!ok) throw new ApiException(400, "Cannot connect: " + err);
        if (!exists)
        {
            if (!s.CreateDatabase)
                throw new ApiException(400, "The server is reachable but the database does not exist. Tick 'Create database if missing'.");
            await CreateDatabaseAsync(cs);
        }
        current = cs;
        try { File.WriteAllText(overridePath, JsonSerializer.Serialize(new { connectionString = cs })); }
        catch (Exception ex) { logger.LogWarning(ex, "Could not save {File}", overridePath); }
    }

    public async Task<ConnectionStatus> StatusAsync()
    {
        if (!IsConfigured)
            return new(false, "No connection configured yet.", null, null, "windows", null, false, true, false, "");
        var b = new SqlConnectionStringBuilder(current);
        string? error = null; var connected = false;
        try { await using var c = new SqlConnection(current); await c.OpenAsync(); connected = true; }
        catch (SqlException ex) { error = ex.Message; }
        var safe = new SqlConnectionStringBuilder(current);
        if (safe.ContainsKey("Password") && !string.IsNullOrEmpty(safe.Password)) safe.Password = "********";
        return new(connected, error, b.DataSource, b.InitialCatalog,
            b.IntegratedSecurity ? "windows" : "sql", b.IntegratedSecurity ? null : b.UserID,
            !string.IsNullOrEmpty(b.Password), b.TrustServerCertificate, b.Encrypt == SqlConnectionEncryptOption.Mandatory,
            safe.ConnectionString);
    }

    // ---- identifier helpers -------------------------------------------------
    static readonly Regex NewIdent = new(@"^[\p{L}_][\p{L}\p{N}_ $#]{0,127}$", RegexOptions.Compiled);

    public static string Quote(string id) => "[" + id.Replace("]", "]]") + "]";

    public static string Full(string? schema, string name) =>
        Quote(string.IsNullOrWhiteSpace(schema) ? "dbo" : schema) + "." + Quote(name);

    public static string ValidateIdent(string? id, string what)
    {
        if (string.IsNullOrWhiteSpace(id) || !NewIdent.IsMatch(id.Trim()))
            throw new ApiException(400, $"Invalid {what} '{id}'. Use letters, digits, underscores or spaces (max 128 chars, must not start with a digit).");
        return id.Trim();
    }

    // ---- value helpers ------------------------------------------------------
    public static object? FromJson(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.TryGetDecimal(out var d) ? d : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => e.GetRawText()
    };

    public static async Task<List<ResultSet>> ReadAllAsync(SqlDataReader r, CancellationToken ct)
    {
        var sets = new List<ResultSet>();
        do
        {
            if (r.FieldCount == 0) continue;
            var cols = new List<string>();
            for (var i = 0; i < r.FieldCount; i++)
            {
                var n = r.GetName(i);
                if (string.IsNullOrEmpty(n)) n = $"Column{i + 1}";
                var baseName = n; var k = 2;
                while (cols.Contains(n)) n = $"{baseName}_{k++}";
                cols.Add(n);
            }

            var isForJson = cols.Count == 1 && cols[0].StartsWith("JSON_F52E2B61", StringComparison.Ordinal);
            var rows = new List<Dictionary<string, object?>>();
            var sb = new System.Text.StringBuilder();
            while (await r.ReadAsync(ct))
            {
                if (isForJson) { sb.Append(r.IsDBNull(0) ? "" : r.GetString(0)); continue; }
                var row = new Dictionary<string, object?>(cols.Count);
                for (var i = 0; i < cols.Count; i++)
                {
                    if (r.IsDBNull(i)) { row[cols[i]] = null; continue; }
                    var v = r.GetValue(i);
                    row[cols[i]] = v.GetType().FullName!.StartsWith("Microsoft.SqlServer") ? v.ToString() : v;
                }
                rows.Add(row);
            }

            if (isForJson)
            {
                JsonElement? json = null;
                if (sb.Length > 0)
                {
                    try { json = JsonDocument.Parse(sb.ToString()).RootElement.Clone(); } catch (JsonException) { }
                }
                sets.Add(new ResultSet(["JSON"], [], json));
            }
            else sets.Add(new ResultSet(cols, rows, null));
        } while (await r.NextResultAsync(ct));
        return sets;
    }
}
