using System.Text.Json;
using System.Threading.Channels;

namespace JsonProcedure.Api.Services;

public record LogRow(string Ts, string Level, int LevelNo, string Category, string Message, string? DetailsJson, long? DurationMs, int? StatusCode);

/// <summary>Thread-safe in-memory queue between the app and the SQLite log writer.</summary>
public class LogSink
{
    readonly Channel<LogRow> channel = Channel.CreateBounded<LogRow>(
        new BoundedChannelOptions(5000) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

    public ChannelReader<LogRow> Reader => channel.Reader;

    public static int LevelNo(string? level) => level?.ToLowerInvariant() switch
    {
        "trace" => 0, "debug" => 1, "information" or "info" => 2, "warning" or "warn" => 3,
        "error" => 4, "critical" => 5, _ => 0
    };

    public static string LevelName(LogLevel l) => l switch
    {
        LogLevel.Trace => "trace", LogLevel.Debug => "debug", LogLevel.Information => "info",
        LogLevel.Warning => "warning", LogLevel.Error => "error", LogLevel.Critical => "critical", _ => "info"
    };

    public void Write(string level, string category, string message, object? details = null, long? durationMs = null, int? statusCode = null)
    {
        string? json = null;
        if (details is not null)
        {
            try { json = JsonSerializer.Serialize(details); } catch (NotSupportedException) { }
        }
        channel.Writer.TryWrite(new LogRow(
            DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), level, LevelNo(level), category,
            message.Length > 4000 ? message[..4000] : message, json, durationMs, statusCode));
    }
}

/// <summary>Forwards ILogger output to the sink. Application categories log Information+, framework ones Warning+.</summary>
public sealed class SqliteLoggerProvider(LogSink sink) : ILoggerProvider
{
    public ILogger CreateLogger(string categoryName) => new SinkLogger(sink, categoryName);
    public void Dispose() { }

    sealed class SinkLogger(LogSink sink, string category) : ILogger
    {
        readonly string shortName = category.StartsWith("JsonProcedure.Api.", StringComparison.Ordinal)
            ? category["JsonProcedure.Api.".Length..] : category;
        readonly LogLevel min = category.StartsWith("JsonProcedure", StringComparison.Ordinal) ? LogLevel.Information : LogLevel.Warning;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None && logLevel >= min;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var msg = formatter(state, exception);
            sink.Write(LogSink.LevelName(logLevel), shortName, msg,
                exception is null ? null : new { exception = exception.GetType().Name, exception.Message, stack = exception.StackTrace });
        }
    }
}

/// <summary>Drains the sink into SQLite in batches and prunes old rows once a day.</summary>
public sealed class LogWriter(UserStore store, LogSink sink) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try { store.PruneLogs(); } catch { /* best effort */ }
        var lastPrune = DateTime.UtcNow;
        var batch = new List<LogRow>(200);
        try
        {
            while (await sink.Reader.WaitToReadAsync(stoppingToken))
            {
                batch.Clear();
                while (batch.Count < 200 && sink.Reader.TryRead(out var row)) batch.Add(row);
                try { store.WriteLogs(batch); } catch { /* never let logging crash the app */ }
                if (DateTime.UtcNow - lastPrune > TimeSpan.FromDays(1))
                {
                    try { store.PruneLogs(); } catch { }
                    lastPrune = DateTime.UtcNow;
                }
                await Task.Delay(250, stoppingToken);   // let rows accumulate so writes are batched
            }
        }
        catch (OperationCanceledException) { }
        // Final flush so the shutdown messages are kept.
        batch.Clear();
        while (sink.Reader.TryRead(out var row)) batch.Add(row);
        try { store.WriteLogs(batch); } catch { }
    }
}
