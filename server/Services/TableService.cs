using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using JsonProcedure.Api.Models;
using Microsoft.Data.SqlClient;

namespace JsonProcedure.Api.Services;

public partial class TableService(Db db)
{
    // ---------------------------------------------------------------- listing
    public async Task<List<TableInfo>> ListAsync(CancellationToken ct)
    {
        await using var conn = await db.OpenAsync(ct);
        const string colSql = """
            SELECT s.name, t.name, c.name, ty.name, c.max_length, c.precision, c.scale,
                   c.is_nullable, c.is_identity, c.is_computed, dc.definition,
                   CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i
                        ON i.object_id=ic.object_id AND i.index_id=ic.index_id
                        WHERE i.is_primary_key=1 AND ic.object_id=c.object_id AND ic.column_id=c.column_id) THEN 1 ELSE 0 END,
                   CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i
                        ON i.object_id=ic.object_id AND i.index_id=ic.index_id
                        WHERE i.is_unique_constraint=1 AND ic.object_id=c.object_id AND ic.column_id=c.column_id) THEN 1 ELSE 0 END,
                   (SELECT TOP 1 rs.name+'.'+rt.name+'('+rc.name+')' FROM sys.foreign_key_columns f
                        JOIN sys.tables rt ON rt.object_id=f.referenced_object_id
                        JOIN sys.schemas rs ON rs.schema_id=rt.schema_id
                        JOIN sys.columns rc ON rc.object_id=f.referenced_object_id AND rc.column_id=f.referenced_column_id
                        WHERE f.parent_object_id=c.object_id AND f.parent_column_id=c.column_id)
            FROM sys.tables t
            JOIN sys.schemas s ON s.schema_id=t.schema_id
            JOIN sys.columns c ON c.object_id=t.object_id
            JOIN sys.types ty ON ty.user_type_id=c.user_type_id
            LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
            WHERE t.is_ms_shipped=0
            ORDER BY s.name, t.name, c.column_id
            """;
        var map = new Dictionary<string, TableInfo>();
        await using (var cmd = new SqlCommand(colSql, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct))
            {
                var key = r.GetString(0) + "." + r.GetString(1);
                if (!map.TryGetValue(key, out var t))
                    map[key] = t = new TableInfo(r.GetString(0), r.GetString(1), 0, []);
                t.Columns.Add(new TableColumnInfo(
                    r.GetString(2), FormatType(r.GetString(3), r.GetInt16(4), r.GetByte(5), r.GetByte(6)),
                    r.GetBoolean(7), r.GetInt32(11) == 1, r.GetBoolean(8), r.GetInt32(12) == 1, r.GetBoolean(9),
                    r.IsDBNull(10) ? null : r.GetString(10), r.IsDBNull(13) ? null : r.GetString(13)));
            }

        var counts = new Dictionary<string, long>();
        const string cntSql = """
            SELECT s.name, t.name, SUM(p.row_count) FROM sys.dm_db_partition_stats p
            JOIN sys.tables t ON t.object_id=p.object_id JOIN sys.schemas s ON s.schema_id=t.schema_id
            WHERE p.index_id IN (0,1) AND t.is_ms_shipped=0 GROUP BY s.name, t.name
            """;
        await using (var cmd = new SqlCommand(cntSql, conn))
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct)) counts[r.GetString(0) + "." + r.GetString(1)] = r.GetInt64(2);

        return map.Select(kv => kv.Value with { RowCount = counts.GetValueOrDefault(kv.Key) }).ToList();
    }

    static string FormatType(string t, int maxLen, int precision, int scale) => t switch
    {
        "nvarchar" or "nchar" => $"{t}({(maxLen == -1 ? "max" : maxLen / 2)})",
        "varchar" or "char" or "varbinary" or "binary" => $"{t}({(maxLen == -1 ? "max" : maxLen)})",
        "decimal" or "numeric" => $"{t}({precision},{scale})",
        "datetime2" or "time" or "datetimeoffset" => $"{t}({scale})",
        _ => t
    };

    async Task<TableInfo> GetAsync(string schema, string name, CancellationToken ct) =>
        (await ListAsync(ct)).FirstOrDefault(t =>
            t.Schema.Equals(schema, StringComparison.OrdinalIgnoreCase) &&
            t.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
        ?? throw new ApiException(404, $"Table {schema}.{name} not found.");

    // ---------------------------------------------------------------- create
    [GeneratedRegex(@"^(NULL|-?\d+(\.\d+)?|'([^']|'')*'|(GETDATE|GETUTCDATE|SYSDATETIME|SYSUTCDATETIME|NEWID|NEWSEQUENTIALID)\(\))$", RegexOptions.IgnoreCase)]
    private static partial Regex DefaultRx();

    static string BuildType(ColumnDef c)
    {
        var t = (c.Type ?? "").Trim().ToLowerInvariant();
        switch (t)
        {
            case "int": case "bigint": case "smallint": case "tinyint": case "bit": case "float": case "real":
            case "money": case "smallmoney": case "date": case "datetime": case "smalldatetime": case "uniqueidentifier":
                return t;
            case "nvarchar": case "varchar": case "varbinary":
                var l = string.IsNullOrWhiteSpace(c.Length) ? "255" : c.Length.Trim().ToLowerInvariant();
                if (l != "max" && !(int.TryParse(l, out var n) && n is > 0 and <= 8000))
                    throw new ApiException(400, $"Invalid length '{c.Length}' for column {c.Name}.");
                if (t == "nvarchar" && l != "max" && int.Parse(l) > 4000)
                    throw new ApiException(400, $"nvarchar length for {c.Name} must be 1-4000 or max.");
                return $"{t}({l})";
            case "nchar": case "char": case "binary":
                var cl = string.IsNullOrWhiteSpace(c.Length) ? "10" : c.Length.Trim();
                if (!(int.TryParse(cl, out var cn) && cn is > 0 and <= 4000))
                    throw new ApiException(400, $"Invalid length '{c.Length}' for column {c.Name}.");
                return $"{t}({cn})";
            case "decimal": case "numeric":
                var p = c.Precision ?? 18; var s = c.Scale ?? 2;
                if (p is < 1 or > 38 || s < 0 || s > p) throw new ApiException(400, $"Invalid precision/scale for column {c.Name}.");
                return $"{t}({p},{s})";
            case "datetime2": case "time": case "datetimeoffset":
                var sc = c.Scale ?? 7;
                if (sc is < 0 or > 7) throw new ApiException(400, $"Invalid scale for column {c.Name}.");
                return $"{t}({sc})";
            default:
                throw new ApiException(400, $"Unsupported type '{c.Type}' for column {c.Name}.");
        }
    }

    public string BuildCreateSql(CreateTableRequest req)
    {
        var schema = string.IsNullOrWhiteSpace(req.Schema) ? "dbo" : Db.ValidateIdent(req.Schema, "schema");
        var table = Db.ValidateIdent(req.Name, "table name");
        if (req.Columns is not { Count: > 0 }) throw new ApiException(400, "A table needs at least one column.");

        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var lines = new List<string>();
        var constraints = new List<string>();
        var pk = new List<string>();
        var safe = Regex.Replace(table, @"\W", "_");

        foreach (var c in req.Columns)
        {
            var cname = Db.ValidateIdent(c.Name, "column name");
            if (!names.Add(cname)) throw new ApiException(400, $"Duplicate column '{cname}'.");
            if (c.PrimaryKey) pk.Add(cname);
            var sb = new StringBuilder($"    {Db.Quote(cname)} {BuildType(c)}");
            if (c.Identity)
            {
                if (!new[] { "int", "bigint", "smallint", "tinyint", "decimal", "numeric" }.Contains(c.Type.ToLowerInvariant()))
                    throw new ApiException(400, $"IDENTITY is not allowed on {c.Type} column '{cname}'.");
                sb.Append(" IDENTITY(1,1)");
            }
            sb.Append(c.Nullable && !c.PrimaryKey && !c.Identity ? " NULL" : " NOT NULL");
            if (!string.IsNullOrWhiteSpace(c.Default))
            {
                var d = c.Default.Trim();
                if (!DefaultRx().IsMatch(d))
                    throw new ApiException(400, $"Default '{d}' for '{cname}' must be a number, 'quoted text', NULL or one of GETDATE(), GETUTCDATE(), SYSDATETIME(), SYSUTCDATETIME(), NEWID().");
                sb.Append($" CONSTRAINT {Db.Quote($"DF_{safe}_{cname}")} DEFAULT {d}");
            }
            lines.Add(sb.ToString());

            if (c.Unique && !c.PrimaryKey)
                constraints.Add($"    CONSTRAINT {Db.Quote($"UQ_{safe}_{cname}")} UNIQUE ({Db.Quote(cname)})");
            if (!string.IsNullOrWhiteSpace(c.Check))
            {
                var ck = c.Check.Trim();
                if (ck.Contains(';') || ck.Contains("--") || ck.Contains("/*"))
                    throw new ApiException(400, $"CHECK expression for '{cname}' contains forbidden characters.");
                constraints.Add($"    CONSTRAINT {Db.Quote($"CK_{safe}_{cname}")} CHECK ({ck})");
            }
            if (c.References is { } fk && !string.IsNullOrWhiteSpace(fk.Table) && !string.IsNullOrWhiteSpace(fk.Column))
            {
                var rs = string.IsNullOrWhiteSpace(fk.Schema) ? "dbo" : fk.Schema;
                constraints.Add($"    CONSTRAINT {Db.Quote($"FK_{safe}_{cname}")} FOREIGN KEY ({Db.Quote(cname)}) REFERENCES {Db.Full(rs, fk.Table)} ({Db.Quote(fk.Column)})");
            }
        }
        if (pk.Count > 0)
            constraints.Insert(0, $"    CONSTRAINT {Db.Quote($"PK_{safe}")} PRIMARY KEY ({string.Join(", ", pk.Select(Db.Quote))})");

        return $"CREATE TABLE {Db.Full(schema, table)} (\n{string.Join(",\n", lines.Concat(constraints))}\n);";
    }

    public async Task<string> CreateAsync(CreateTableRequest req, CancellationToken ct)
    {
        var sql = BuildCreateSql(req);
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync(ct);
        return sql;
    }

    public async Task DropAsync(string schema, string name, CancellationToken ct)
    {
        await GetAsync(schema, name, ct);
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = new SqlCommand($"DROP TABLE {Db.Full(schema, name)}", conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    // ---------------------------------------------------------------- rows
    public async Task<ResultSet> RowsAsync(string schema, string name, int top, CancellationToken ct)
    {
        await GetAsync(schema, name, ct);
        top = Math.Clamp(top, 1, 10000);
        await using var conn = await db.OpenAsync(ct);
        await using var cmd = new SqlCommand($"SELECT TOP ({top}) * FROM {Db.Full(schema, name)}", conn);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        var sets = await Db.ReadAllAsync(r, ct);
        return sets.FirstOrDefault() ?? new ResultSet([], [], null);
    }

    public async Task<int> InsertAsync(string schema, string name, List<Dictionary<string, JsonElement>> rows, CancellationToken ct)
    {
        if (rows.Count == 0) throw new ApiException(400, "No rows supplied.");
        var table = await GetAsync(schema, name, ct);
        var writable = table.Columns.Where(c => !c.Identity && !c.Computed)
            .ToDictionary(c => c.Name, StringComparer.OrdinalIgnoreCase);
        var skipped = table.Columns.Where(c => c.Identity || c.Computed)
            .Select(c => c.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        await using var conn = await db.OpenAsync(ct);
        await using var tx = (SqlTransaction)await conn.BeginTransactionAsync(ct);
        var i = 0;
        try
        {
            foreach (var row in rows)
            {
                i++;
                var unknown = row.Keys.Where(k => !writable.ContainsKey(k) && !skipped.Contains(k)).ToList();
                if (unknown.Count > 0)
                    throw new ApiException(400, $"Row {i}: unknown column(s) {string.Join(", ", unknown)}.");
                var used = row.Where(kv => writable.ContainsKey(kv.Key)).ToList();

                await using var cmd = new SqlCommand { Connection = conn, Transaction = tx };
                if (used.Count == 0)
                    cmd.CommandText = $"INSERT INTO {Db.Full(schema, name)} DEFAULT VALUES";
                else
                {
                    for (var n = 0; n < used.Count; n++)
                        cmd.Parameters.AddWithValue("@p" + n, Db.FromJson(used[n].Value) ?? DBNull.Value);
                    cmd.CommandText =
                        $"INSERT INTO {Db.Full(schema, name)} ({string.Join(", ", used.Select(kv => Db.Quote(writable[kv.Key].Name)))}) " +
                        $"VALUES ({string.Join(", ", used.Select((_, n) => "@p" + n))})";
                }
                await cmd.ExecuteNonQueryAsync(ct);
            }
            await tx.CommitAsync(ct);
        }
        catch (SqlException ex)
        {
            await tx.RollbackAsync(CancellationToken.None);
            throw new ApiException(400, $"Row {i} failed (nothing was saved): {ex.Message}");
        }
        catch
        {
            await tx.RollbackAsync(CancellationToken.None);
            throw;
        }
        return rows.Count;
    }

    // ---------------------------------------------------------------- inference
    public List<ColumnDef> Infer(List<Dictionary<string, JsonElement>> rows)
    {
        if (rows.Count == 0) throw new ApiException(400, "The JSON contains no rows.");
        var keys = new List<string>();
        foreach (var r in rows) foreach (var k in r.Keys) if (!keys.Contains(k)) keys.Add(k);

        var result = new List<ColumnDef>();
        foreach (var k in keys)
        {
            var missing = rows.Any(r => !r.ContainsKey(k));
            var nn = rows.Where(r => r.TryGetValue(k, out var v) && v.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined))
                         .Select(r => r[k]).ToList();
            var nullable = missing || nn.Count < rows.Count;
            var type = "nvarchar"; string? len = "max";
            var isPk = false;

            if (nn.Count == 0) len = "255";
            else if (nn.All(v => v.ValueKind is JsonValueKind.True or JsonValueKind.False)) { type = "bit"; len = null; }
            else if (nn.All(v => v.ValueKind == JsonValueKind.Number))
            {
                len = null;
                if (nn.All(v => v.TryGetInt64(out _)))
                {
                    type = nn.All(v => v.GetInt64() is >= int.MinValue and <= int.MaxValue) ? "int" : "bigint";
                    isPk = !nullable && k.Equals("id", StringComparison.OrdinalIgnoreCase)
                           && nn.Select(v => v.GetInt64()).Distinct().Count() == nn.Count;
                }
                else type = "float";
            }
            else if (nn.All(v => v.ValueKind == JsonValueKind.String))
            {
                var strs = nn.Select(v => v.GetString()!).ToList();
                if (strs.All(s => Guid.TryParse(s, out _))) { type = "uniqueidentifier"; len = null; }
                else if (strs.All(s => DateOnlyRx().IsMatch(s))) { type = "date"; len = null; }
                else if (strs.All(s => DateTimeRx().IsMatch(s) &&
                         DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _)))
                { type = "datetime2"; len = null; }
                else
                {
                    var max = strs.Max(s => s.Length);
                    len = max > 2000 ? "max" : Math.Max(50, max * 2).ToString();
                }
            }
            result.Add(new ColumnDef(k, type, len, Nullable: nullable, PrimaryKey: isPk));
        }
        return result;
    }

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")] private static partial Regex DateOnlyRx();
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")] private static partial Regex DateTimeRx();
}
