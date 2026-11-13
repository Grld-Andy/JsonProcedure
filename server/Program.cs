using System.Text.Json;
using JsonProcedure.Api.Models;
using JsonProcedure.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Data.SqlClient;
using Microsoft.Data.Sqlite;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// Activity log: ILogger output and API requests are queued and written to userdata.db.
var logSink = new LogSink();
builder.Services.AddSingleton(logSink);
builder.Logging.AddProvider(new SqliteLoggerProvider(logSink));
var dataProtection = builder.Services.AddDataProtection()
    .SetApplicationName("JsonProcedure")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(builder.Environment.ContentRootPath, "keys")));
if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi();   // keys at rest are tied to this Windows user
builder.Services.AddSingleton<UserStore>();
builder.Services.AddHostedService<LogWriter>();
builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<TableService>();
builder.Services.AddSingleton<ProcedureService>();
builder.Services.AddOpenApi();
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.DictionaryKeyPolicy = null;   // keep column names exactly as in the database
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

// Create the database on startup if the server is reachable but the database is missing.
// The app still starts when it is not, so a connection can be configured from the UI.
try
{
    var db0 = app.Services.GetRequiredService<Db>();
    var (serverOk, exists, err) = db0.IsConfigured ? await db0.TestAsync(db0.ConnectionString) : (true, true, null);
    if (serverOk && !exists) await db0.CreateDatabaseAsync(db0.ConnectionString);
    else if (!serverOk) app.Logger.LogWarning("Database server unreachable: {Error}. Configure a connection from the UI.", err);
}
catch (Exception ex) { app.Logger.LogWarning(ex, "Startup database check failed."); }

// Record every API call in the activity log (request bodies are never stored).
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    if (!path.StartsWithSegments("/api") || path.StartsWithSegments("/api/logs")) { await next(); return; }
    var sw = System.Diagnostics.Stopwatch.StartNew();
    try { await next(); }
    catch (Exception ex)
    {
        logSink.Write("error", "http", $"{ctx.Request.Method} {path} failed: {ex.Message}", new { error = ex.Message }, sw.ElapsedMilliseconds, 500);
        throw;
    }
    var code = ctx.Response.StatusCode;
    var level = code >= 500 ? "error" : code >= 400 ? "warning" : ctx.Request.Method == "GET" ? "debug" : "info";
    var err = ctx.Items["apiError"] as string;
    logSink.Write(level, "http", $"{ctx.Request.Method} {path}{ctx.Request.QueryString} -> {code}",
        err is null ? null : new { error = err }, sw.ElapsedMilliseconds, code);
});

// Turn exceptions into { "error": "..." } JSON responses.
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Exception ex) when (ex is ApiException or SqlException or SqliteException or JsonException or BadHttpRequestException)
    {
        var status = ex switch { ApiException a => a.Status, _ => 400 };
        var msg = ex switch
        {
            SqlException s => $"SQL error {s.Number}: {s.Message}",
            SqliteException s => $"SQLite error {s.SqliteErrorCode}: {s.Message}",
            BadHttpRequestException => "Invalid request body.",
            _ => ex.Message
        };
        ctx.Items["apiError"] = msg;
        if (!ctx.Response.HasStarted)
        {
            ctx.Response.StatusCode = status;
            await ctx.Response.WriteAsJsonAsync(new { error = msg });
        }
    }
});

app.UseCors();
app.MapOpenApi();                                        // /openapi/v1.json
app.UseSwaggerUI(o =>                                    // /docs
{
    o.RoutePrefix = "docs";
    o.DocumentTitle = "JsonProcedure API - Swagger";
    o.SwaggerEndpoint("/openapi/v1.json", "JsonProcedure API v1");
});
app.MapScalarApiReference("/scalar", o => o.WithTitle("JsonProcedure API").WithOpenApiRoutePattern("/openapi/v1.json"));

var api = app.MapGroup("/api");

// -------------------------------------------------------------- connection
var conn = api.MapGroup("/connection").WithTags("Connection");
conn.MapGet("/", (Db d) => d.StatusAsync()).WithSummary("Current connection status (password is never returned)");
conn.MapPost("/test", async (ConnectionSettings s, Db d) =>
    {
        var (ok, exists, err) = await d.TestAsync(Db.BuildConnectionString(s));
        return Results.Ok(new { serverReachable = ok, databaseExists = exists, error = err });
    })
    .WithSummary("Test a connection (form fields or a raw connection string) without switching to it");
conn.MapPut("/", async (ConnectionSettings s, Db d) => { await d.ApplyAsync(s); return Results.Ok(await d.StatusAsync()); })
    .WithSummary("Switch the app to a different database and remember it");

// ------------------------------------------------------------------ tables
var tables = api.MapGroup("/tables").WithTags("Tables");
tables.MapGet("/", (TableService s, CancellationToken ct) => s.ListAsync(ct))
    .WithSummary("List all user tables with columns and constraints");
tables.MapPost("/preview", (CreateTableRequest r, TableService s) => new { sql = s.BuildCreateSql(r) })
    .WithSummary("Preview the CREATE TABLE statement without running it");
tables.MapPost("/", async (CreateTableRequest r, TableService s, CancellationToken ct) =>
        Results.Ok(new { sql = await s.CreateAsync(r, ct) }))
    .WithSummary("Create a table from a name, columns and constraints");
tables.MapPost("/infer", (InferRequest r, TableService s) => s.Infer(r.Rows))
    .WithSummary("Infer column definitions from a JSON array of objects");
tables.MapDelete("/{schema}/{name}", async (string schema, string name, TableService s, CancellationToken ct) =>
    { await s.DropAsync(schema, name, ct); return Results.NoContent(); })
    .WithSummary("Drop a table");
tables.MapGet("/{schema}/{name}/rows", (string schema, string name, int? top, TableService s, CancellationToken ct) =>
        s.RowsAsync(schema, name, top ?? 100, ct))
    .WithSummary("Read rows from a table");
tables.MapPost("/{schema}/{name}/rows", async (string schema, string name, InsertRowRequest r, TableService s, CancellationToken ct) =>
        Results.Ok(new { inserted = await s.InsertAsync(schema, name, [r.Values], ct) }))
    .WithSummary("Insert a single row manually");
tables.MapPost("/{schema}/{name}/import", async (string schema, string name, ImportRequest r, TableService s, CancellationToken ct) =>
        Results.Ok(new { inserted = await s.InsertAsync(schema, name, r.Rows, ct) }))
    .WithSummary("Bulk insert rows from a JSON array (all-or-nothing)");

// -------------------------------------------------------------- procedures
var procs = api.MapGroup("/procedures").WithTags("Procedures");
procs.MapGet("/", (ProcedureService s, CancellationToken ct) => s.ListAsync(ct))
    .WithSummary("List stored procedures that already exist in the database");
procs.MapPost("/", async (SaveProcedureRequest r, ProcedureService s, CancellationToken ct) =>
        { await s.SaveAsync(r.Script, ct); return Results.Ok(new { saved = true }); })
    .WithSummary("Create or alter a stored procedure from a T-SQL script");
procs.MapGet("/{schema}/{name}", (string schema, string name, ProcedureService s, CancellationToken ct) =>
        s.GetAsync(schema, name, ct))
    .WithSummary("Get a procedure's definition and parameters");
procs.MapDelete("/{schema}/{name}", async (string schema, string name, ProcedureService s, CancellationToken ct) =>
        { await s.DropAsync(schema, name, ct); return Results.NoContent(); })
    .WithSummary("Drop a stored procedure");
procs.MapPost("/{schema}/{name}/execute", (string schema, string name, ExecuteRequest r, ProcedureService s, CancellationToken ct) =>
        s.ExecuteAsync(schema, name, r.Parameters, ct))
    .WithSummary("Execute a stored procedure and return every result set as JSON");

// ---------------------------------------------------- settings / profile
var settings = api.MapGroup("/settings").WithTags("Settings");
settings.MapGet("/", (UserStore u) => u.GetSettings())
    .WithSummary("All stored settings (profile, theme, apiMode, apiBaseUrl, tourSeen, ...)");
settings.MapPut("/", (Dictionary<string, JsonElement> values, UserStore u) => u.PutSettings(values))
    .WithSummary("Merge the given keys into the stored settings (a null value removes a key)");

// ------------------------------------------------------ saved connections
var saved = api.MapGroup("/connections/saved").WithTags("Saved connections");
saved.MapGet("/", (UserStore u) => u.ListConnections()).WithSummary("List saved connections (secrets are never returned)");
saved.MapGet("/{id:long}", (long id, UserStore u) => u.GetConnection(id)).WithSummary("Get one saved connection");
saved.MapPost("/", (SaveConnectionRequest r, UserStore u) => u.SaveConnection(r))
    .WithSummary("Create or update a saved connection by name; omitted secrets keep their stored value");
saved.MapPost("/{id:long}/apply", async (long id, ApplySavedConnectionRequest? r, UserStore u, Db d) =>
    {
        await d.ApplyAsync(u.GetConnectionSettings(id, r?.CreateDatabase ?? false));
        return Results.Ok(await d.StatusAsync());
    })
    .WithSummary("Switch the app to a saved connection");
saved.MapDelete("/{id:long}", (long id, UserStore u) => { u.DeleteConnection(id); return Results.NoContent(); })
    .WithSummary("Remove a saved connection entry (does not touch any database)");

// ----------------------------------------------------------------- drafts
var drafts = api.MapGroup("/drafts").WithTags("Drafts");
drafts.MapGet("/", (string? schema, string? name, bool? all, UserStore u) =>
        all == true ? u.ListDrafts(null, null, false) : u.ListDrafts(schema, name, true))
    .WithSummary("Get the unsaved editor draft for a procedure (omit schema/name for the new-procedure draft), or all drafts with all=true");
drafts.MapPut("/", (SaveDraftRequest r, UserStore u) => u.SaveDraft(r)).WithSummary("Save an editor draft");
drafts.MapDelete("/", (string? schema, string? name, UserStore u) => { u.DeleteDraft(schema, name); return Results.NoContent(); })
    .WithSummary("Discard an editor draft (for example after the procedure was saved)");

// -------------------------------------------------- execution history
var history = api.MapGroup("/history").WithTags("History");
history.MapGet("/", (string? schema, string? name, int? limit, long? before, UserStore u) =>
        u.ListExecutions(schema, name, limit ?? 50, before))
    .WithSummary("Procedure execution history, newest first");
history.MapGet("/{id:long}", (long id, UserStore u) => u.GetExecution(id))
    .WithSummary("One history entry including its parameters and result");
history.MapPost("/clear", (string? schema, string? name, UserStore u) => new { cleared = u.ClearExecutions(schema, name) })
    .WithSummary("Clear execution history (optionally for one procedure). Only history rows are removed.");

// ------------------------------------------------------ parameter sets
var psets = api.MapGroup("/parameter-sets").WithTags("Parameter sets");
psets.MapGet("/", (string? schema, string? name, UserStore u) => u.ListParameterSets(schema, name))
    .WithSummary("Saved parameter sets, optionally for one procedure");
psets.MapPost("/", (SaveParameterSetRequest r, UserStore u) => u.SaveParameterSet(r)).WithSummary("Save a named parameter set");
psets.MapDelete("/{id:long}", (long id, UserStore u) => { u.DeleteParameterSet(id); return Results.NoContent(); })
    .WithSummary("Remove a saved parameter set");

// -------------------------------------------------------------- favorites
var favs = api.MapGroup("/favorites").WithTags("Favorites");
favs.MapGet("/", (UserStore u) => u.ListFavorites()).WithSummary("Favorite tables and procedures");
favs.MapPut("/", (FavoriteRequest r, UserStore u) => { u.AddFavorite(r); return Results.NoContent(); }).WithSummary("Mark as favorite");
favs.MapDelete("/", (string kind, string schema, string name, UserStore u) =>
        { u.RemoveFavorite(kind, schema, name); return Results.NoContent(); })
    .WithSummary("Remove a favorite mark");

// ------------------------------------------------------------------- logs
var logs = api.MapGroup("/logs").WithTags("Logs");
logs.MapGet("/", (string? level, string? category, string? q, string? from, string? to, long? before, int? limit, UserStore u) =>
        u.QueryLogs(level, category, q, from, to, before, limit ?? 100))
    .WithSummary("Activity log, newest first. level is the minimum severity (debug|info|warning|error).");
logs.MapGet("/categories", (UserStore u) => u.LogCategories()).WithSummary("Distinct log categories");
logs.MapPost("/clear", (UserStore u) => new { cleared = u.ClearLogs() }).WithSummary("Delete all log entries");

// Serve the built React app (client build is copied into wwwroot).
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("index.html");

app.Run();
