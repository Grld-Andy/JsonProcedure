using System.Data;
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using JsonProcedure.Api.Models;
using Microsoft.Data.SqlClient;

namespace JsonProcedure.Api.Services;

public partial class ProcedureService(Db db, UserStore store, ILogger<ProcedureService> logger)
{
    // Reads every user-defined stored procedure that already exists in the database.
    public async Task<List<ProcedureSummary>> ListAsync(CancellationToken ct)
    {
        const string sql = """
            SELECT s.name, p.name, p.create_date, p.modify_date,
                   (SELECT COUNT(*) FROM sys.parameters x WHERE x.object_id=p.object_id AND x.parameter_id>0)
            FROM sys.procedures p JOIN sys.schemas s ON s.schema_id=p.schema_id
            WHERE p.is_ms_shipped=0
            ORDER BY s.name, p.name
            """;
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var list = new List<ProcedureSummary>();
        while (await r.ReadAsync(ct))
            list.Add(new(r.GetString(0), r.GetString(1), r.GetDateTime(2), r.GetDateTime(3), r.GetInt32(4)));
        return list;
    }

    public async Task<ProcedureDetail> GetAsync(string schema, string name, CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        var full = Db.Full(schema, name);
        int? objectId;
        await using (var cmd = new SqlCommand("SELECT OBJECT_ID(@n, 'P')", conn))
        {
            cmd.Parameters.AddWithValue("@n", full);
            var o = await cmd.ExecuteScalarAsync(ct);
            objectId = o is DBNull or null ? null : (int)o;
        }
        if (objectId is null) throw new ApiException(404, $"Procedure {schema}.{name} not found.");

        string? definition;
        await using (var cmd = new SqlCommand("SELECT OBJECT_DEFINITION(@id)", conn))
        {
            cmd.Parameters.AddWithValue("@id", objectId);
            var o = await cmd.ExecuteScalarAsync(ct);
            definition = o as string;
        }

        var ps = new List<ProcedureParameter>();
        const string psql = """
            SELECT p.name, ty.name, p.max_length, p.precision, p.scale, p.is_output, p.has_default_value
            FROM sys.parameters p JOIN sys.types ty ON ty.user_type_id=p.user_type_id
            WHERE p.object_id=@id AND p.parameter_id>0 ORDER BY p.parameter_id
            """;
        await using (var cmd = new SqlCommand(psql, conn))
        {
            cmd.Parameters.AddWithValue("@id", objectId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var t = r.GetString(1);
                var type = t switch
                {
                    "nvarchar" or "nchar" => $"{t}({(r.GetInt16(2) == -1 ? "max" : r.GetInt16(2) / 2)})",
                    "varchar" or "char" or "varbinary" or "binary" => $"{t}({(r.GetInt16(2) == -1 ? "max" : r.GetInt16(2))})",
                    "decimal" or "numeric" => $"{t}({r.GetByte(3)},{r.GetByte(4)})",
                    _ => t
                };
                ps.Add(new(r.GetString(0), type, r.GetBoolean(5), r.GetBoolean(6)));
            }
        }
        return new(schema, name, definition, definition is null, ps);
    }

    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex GoRx();

    [GeneratedRegex(@"^\s*CREATE\s+(OR\s+ALTER\s+)?PROC(EDURE)?\s+((\[[^\]]+\]|\w+)\s*\.\s*)?(\[[^\]]+\]|\w+)|^\s*ALTER\s+PROC(EDURE)?\s+((\[[^\]]+\]|\w+)\s*\.\s*)?(\[[^\]]+\]|\w+)",
        RegexOptions.IgnoreCase)]
    private static partial Regex ProcRx();

    [GeneratedRegex(@"(--[^\r\n]*)|(/\*.*?\*/)", RegexOptions.Singleline)]
    private static partial Regex CommentRx();

    /// <summary>Runs a CREATE/ALTER PROCEDURE script against the database.</summary>
    public async Task SaveAsync(string script, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(script)) throw new ApiException(400, "Script is empty.");
        var batches = GoRx().Split(script).Where(b => !string.IsNullOrWhiteSpace(b)).ToList();
        foreach (var b in batches)
        {
            // Only allow batches that start with CREATE/ALTER PROCEDURE (after comments).
            var stripped = CommentRx().Replace(b, " ");
            if (!ProcRx().IsMatch(stripped))
                throw new ApiException(400, "Each batch must start with CREATE PROCEDURE, CREATE OR ALTER PROCEDURE or ALTER PROCEDURE.");
        }
        await using var conn = await db.OpenAsync(ct);
        foreach (var b in batches)
        {
            await using var cmd = new SqlCommand(b, conn);
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    public async Task DropAsync(string schema, string name, CancellationToken ct)
    {
        await GetAsync(schema, name, ct);
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = new SqlCommand($"DROP PROCEDURE {Db.Full(schema, name)}", conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    const int HistoryRowsPerSet = 100;

    /// <summary>Executes the procedure and records the run (success or failure) in the history.</summary>
    public async Task<ExecutionResult> ExecuteAsync(
        string schema, string name, Dictionary<string, JsonElement>? args, CancellationToken ct)
    {
        var database = (string?)null;
        try { database = db.IsConfigured ? new SqlConnectionStringBuilder(db.ConnectionString).InitialCatalog : null; } catch { }
        try
        {
            var res = await ExecuteCoreAsync(schema, name, args, ct);
            var capped = res with
            {
                ResultSets = res.ResultSets.Select(s => s.Rows.Count > HistoryRowsPerSet
                    ? s with { Rows = s.Rows.Take(HistoryRowsPerSet).ToList() } : s).ToList()
            };
            store.AddExecution(schema, name, "sqlserver", database, args, "success", null,
                res.ElapsedMs, res.RowsAffected, res.ReturnValue, capped);
            logger.LogInformation("Executed {Schema}.{Name} in {Ms} ms", schema, name, res.ElapsedMs);
            return res;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            store.AddExecution(schema, name, "sqlserver", database, args, "error", ex.Message, 0, 0, null, null);
            logger.LogWarning("Execution of {Schema}.{Name} failed: {Error}", schema, name, ex.Message);
            throw;
        }
    }

    async Task<ExecutionResult> ExecuteCoreAsync(
        string schema, string name, Dictionary<string, JsonElement>? args, CancellationToken ct)
    {
        await GetAsync(schema, name, ct);
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = new SqlCommand(Db.Full(schema, name), conn) { CommandType = CommandType.StoredProcedure };
        SqlCommandBuilder.DeriveParameters(cmd);

        var supplied = (args ?? []).ToDictionary(kv => kv.Key.TrimStart('@'), kv => kv.Value, StringComparer.OrdinalIgnoreCase);
        foreach (SqlParameter p in cmd.Parameters)
        {
            if (p.Direction == ParameterDirection.ReturnValue) continue;
            var key = p.ParameterName.TrimStart('@');
            if (supplied.Remove(key, out var el))
            {
                var v = Db.FromJson(el);
                p.Value = v is null ? DBNull.Value : Coerce(v, p.SqlDbType);
            }
            else if (p.Direction == ParameterDirection.InputOutput)
                p.Value = DBNull.Value;   // OUTPUT parameters must always be sent
        }
        if (supplied.Count > 0)
            throw new ApiException(400, $"Unknown parameter(s): {string.Join(", ", supplied.Keys)}.");

        var sw = Stopwatch.StartNew();
        List<ResultSet> sets;
        int affected;
        try
        {
            await using var r = await cmd.ExecuteReaderAsync(ct);
            sets = await Db.ReadAllAsync(r, ct);
            affected = r.RecordsAffected;
        }
        catch (InvalidCastException ex) { throw new ApiException(400, "Parameter type mismatch: " + ex.Message); }
        catch (FormatException ex) { throw new ApiException(400, "Parameter format error: " + ex.Message); }
        sw.Stop();

        var outputs = new Dictionary<string, object?>();
        int? ret = null;
        foreach (SqlParameter p in cmd.Parameters)
        {
            if (p.Direction == ParameterDirection.ReturnValue) ret = p.Value as int?;
            else if (p.Direction is ParameterDirection.Output or ParameterDirection.InputOutput)
                outputs[p.ParameterName] = p.Value is DBNull ? null : p.Value;
        }
        return new(sets, outputs, ret, Math.Max(affected, 0), sw.ElapsedMilliseconds);
    }

    static object Coerce(object v, SqlDbType t)
    {
        if (v is not string s) return v;
        return t switch
        {
            SqlDbType.UniqueIdentifier => Guid.Parse(s),
            SqlDbType.Date or SqlDbType.DateTime or SqlDbType.DateTime2 or SqlDbType.SmallDateTime =>
                DateTime.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            SqlDbType.DateTimeOffset => DateTimeOffset.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            SqlDbType.Time => TimeSpan.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            SqlDbType.Int or SqlDbType.SmallInt or SqlDbType.TinyInt or SqlDbType.BigInt =>
                long.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            SqlDbType.Decimal or SqlDbType.Money or SqlDbType.SmallMoney =>
                decimal.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            SqlDbType.Float or SqlDbType.Real => double.Parse(s, System.Globalization.CultureInfo.InvariantCulture),
            SqlDbType.Bit => bool.TryParse(s, out var b) ? b : s == "1",
            _ => s
        };
    }
}
