using System.Text.Json;

namespace JsonProcedure.Api.Models;

public class ApiException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

public record ForeignKeyRef(string? Schema, string Table, string Column);

public record ColumnDef(
    string Name,
    string Type,
    string? Length = null,
    int? Precision = null,
    int? Scale = null,
    bool Nullable = true,
    bool PrimaryKey = false,
    bool Identity = false,
    bool Unique = false,
    string? Default = null,
    string? Check = null,
    ForeignKeyRef? References = null);

public record CreateTableRequest(string? Schema, string Name, List<ColumnDef> Columns);

public record InferRequest(List<Dictionary<string, JsonElement>> Rows);

public record ImportRequest(List<Dictionary<string, JsonElement>> Rows);

public record InsertRowRequest(Dictionary<string, JsonElement> Values);

public record TableColumnInfo(
    string Name, string Type, bool Nullable, bool PrimaryKey, bool Identity,
    bool Unique, bool Computed, string? Default, string? References);

public record TableInfo(string Schema, string Name, long RowCount, List<TableColumnInfo> Columns);

public record ProcedureSummary(string Schema, string Name, DateTime Created, DateTime Modified, int ParameterCount);

public record ProcedureParameter(string Name, string Type, bool IsOutput, bool HasDefault);

public record ProcedureDetail(
    string Schema, string Name, string? Definition, bool IsEncrypted, List<ProcedureParameter> Parameters);

public record SaveProcedureRequest(string Script);

public record ExecuteRequest(Dictionary<string, JsonElement>? Parameters);

public record ResultSet(List<string> Columns, List<Dictionary<string, object?>> Rows, JsonElement? Json);

public record ExecutionResult(
    List<ResultSet> ResultSets,
    Dictionary<string, object?> OutputParameters,
    int? ReturnValue,
    int RowsAffected,
    long ElapsedMs);
