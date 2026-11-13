using System.Text.Json;

namespace JsonProcedure.Api.Models;

// ---- saved connections (secrets are never returned) ---------------------------
public record SavedConnection(
    long Id, string Name, string DbType, string? Server, int? Port, string? Database,
    string? AuthType, string? User, bool HasPassword, bool UsesConnectionString,
    bool TrustServerCertificate, bool Encrypt, string CreatedAt, string UpdatedAt);

/// <summary>Password / ConnectionString left null on an update keep the stored value.</summary>
public record SaveConnectionRequest(
    string Name, string? DbType, string? ConnectionString, string? Server, int? Port, string? Database,
    string? AuthType, string? User, string? Password, bool? TrustServerCertificate, bool? Encrypt);

public record ApplySavedConnectionRequest(bool CreateDatabase = false);

// ---- drafts -----------------------------------------------------------------------
public record Draft(long Id, string? Schema, string? Name, string Script, string UpdatedAt);

public record SaveDraftRequest(string? Schema, string? Name, string Script);

// ---- execution history ---------------------------------------------------------------
public record ExecutionRecordSummary(
    long Id, string Schema, string Name, string DbType, string? Database, string Status,
    string? Error, long ElapsedMs, int RowsAffected, int? ReturnValue, string CreatedAt);

public record ExecutionRecord(
    long Id, string Schema, string Name, string DbType, string? Database, string Status,
    string? Error, long ElapsedMs, int RowsAffected, int? ReturnValue, string CreatedAt,
    JsonElement? Parameters, JsonElement? Result);

// ---- parameter sets --------------------------------------------------------------------
public record ParameterSet(long Id, string Schema, string Name, string Label, JsonElement Parameters, string CreatedAt);

public record SaveParameterSetRequest(string Schema, string Name, string Label, JsonElement Parameters);

// ---- favorites ---------------------------------------------------------------------------
public record Favorite(string Kind, string Schema, string Name, string CreatedAt);

public record FavoriteRequest(string Kind, string Schema, string Name);

// ---- logs ------------------------------------------------------------------------------------
public record LogEntry(
    long Id, string Ts, string Level, string Category, string Message,
    JsonElement? Details, long? DurationMs, int? StatusCode);

public record LogPage(List<LogEntry> Items, long? NextBefore);
