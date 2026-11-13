import type {
  ColumnDef,
  ConnectionSettings,
  ConnectionStatus,
  ExecutionResult,
  ProcedureDetail,
  ProcedureSummary,
  ResultSet,
  TableInfo,
} from './api';

interface SimTable {
  schema: string;
  name: string;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    primaryKey: boolean;
    identity: boolean;
    unique: boolean;
    computed: boolean;
    default: string | null;
    references: string | null;
  }[];
  rows: Record<string, unknown>[];
}

interface SimProcedure {
  schema: string;
  name: string;
  created: string;
  modified: string;
  definition: string;
  isEncrypted: boolean;
  parameters: {
    name: string;
    type: string;
    isOutput: boolean;
    hasDefault: boolean;
  }[];
}

let simConn: ConnectionStatus = {
  connected: true,
  error: null,
  dbType: 'sqlserver',
  server: 'localhost',
  database: 'JsonProcedure',
  authType: 'windows',
  user: null,
  hasPassword: false,
  trustServerCertificate: true,
  encrypt: false,
  connectionString:
    'Server=localhost;Database=JsonProcedure;Trusted_Connection=True;TrustServerCertificate=True;',
};

let simTables: SimTable[] = [
  {
    schema: 'dbo',
    name: 'Customers',
    columns: [
      {
        name: 'Id',
        type: 'int',
        nullable: false,
        primaryKey: true,
        identity: true,
        unique: true,
        computed: false,
        default: null,
        references: null,
      },
      {
        name: 'Name',
        type: 'nvarchar(100)',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: false,
        computed: false,
        default: null,
        references: null,
      },
      {
        name: 'Email',
        type: 'nvarchar(255)',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: true,
        computed: false,
        default: null,
        references: null,
      },
      {
        name: 'PlanTier',
        type: 'nvarchar(40)',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: false,
        computed: false,
        default: "'Starter'",
        references: null,
      },
      {
        name: 'Active',
        type: 'bit',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: false,
        computed: false,
        default: '1',
        references: null,
      },
    ],
    rows: [
      { Id: 1, Name: 'Northstar Logistics', Email: 'ops@northstar.io', PlanTier: 'Enterprise', Active: true },
      { Id: 2, Name: 'Kestrel Health', Email: 'billing@kestrelhealth.com', PlanTier: 'Growth', Active: true },
      { Id: 3, Name: 'Harborline Freight', Email: 'infra@harborline.co', PlanTier: 'Enterprise', Active: true },
      { Id: 4, Name: 'Bramble Pay', Email: 'admin@bramblepay.com', PlanTier: 'Starter', Active: false },
    ],
  },
  {
    schema: 'dbo',
    name: 'Orders',
    columns: [
      {
        name: 'OrderId',
        type: 'int',
        nullable: false,
        primaryKey: true,
        identity: true,
        unique: true,
        computed: false,
        default: null,
        references: null,
      },
      {
        name: 'CustomerId',
        type: 'int',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: false,
        computed: false,
        default: null,
        references: 'dbo.Customers(Id)',
      },
      {
        name: 'OrderRef',
        type: 'nvarchar(32)',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: true,
        computed: false,
        default: null,
        references: null,
      },
      {
        name: 'TotalAmount',
        type: 'decimal(18,2)',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: false,
        computed: false,
        default: '0',
        references: null,
      },
      {
        name: 'Status',
        type: 'nvarchar(24)',
        nullable: false,
        primaryKey: false,
        identity: false,
        unique: false,
        computed: false,
        default: "'Pending'",
        references: null,
      },
    ],
    rows: [
      { OrderId: 101, CustomerId: 1, OrderRef: 'ORD-8841', TotalAmount: 2480.0, Status: 'Completed' },
      { OrderId: 102, CustomerId: 3, OrderRef: 'ORD-8842', TotalAmount: 3150.0, Status: 'Completed' },
      { OrderId: 103, CustomerId: 2, OrderRef: 'ORD-8843', TotalAmount: 890.5, Status: 'Processing' },
      { OrderId: 104, CustomerId: 4, OrderRef: 'ORD-8844', TotalAmount: 149.0, Status: 'Failed' },
    ],
  },
];

let simProcedures: SimProcedure[] = [
  {
    schema: 'dbo',
    name: 'GetActiveCustomers',
    created: '2026-11-10T09:15:00Z',
    modified: '2026-11-12T10:20:00Z',
    isEncrypted: false,
    parameters: [
      { name: '@PlanTier', type: 'nvarchar(40)', isOutput: false, hasDefault: true },
    ],
    definition: `CREATE PROCEDURE dbo.GetActiveCustomers
    @PlanTier nvarchar(40) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT Id, Name, Email, PlanTier, Active
    FROM dbo.Customers
    WHERE Active = 1
      AND (@PlanTier IS NULL OR PlanTier = @PlanTier)
    ORDER BY Id;
END`,
  },
  {
    schema: 'dbo',
    name: 'GetCustomerOrders',
    created: '2026-11-10T11:00:00Z',
    modified: '2026-11-12T11:45:00Z',
    isEncrypted: false,
    parameters: [
      { name: '@CustomerId', type: 'int', isOutput: false, hasDefault: true },
      { name: '@TotalCount', type: 'int', isOutput: true, hasDefault: false },
    ],
    definition: `CREATE PROCEDURE dbo.GetCustomerOrders
    @CustomerId int = NULL,
    @TotalCount int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    SELECT OrderId, CustomerId, OrderRef, TotalAmount, Status
    FROM dbo.Orders
    WHERE @CustomerId IS NULL OR CustomerId = @CustomerId
    ORDER BY OrderId DESC;

    SELECT @TotalCount = @@ROWCOUNT;
END`,
  },
];

function delay(ms = 120): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatColSql(c: ColumnDef): string {
  let typeStr = c.type;
  if (c.length) typeStr += `(${c.length})`;
  else if (c.precision !== undefined && c.precision !== null) {
    typeStr += c.scale !== undefined && c.scale !== null ? `(${c.precision},${c.scale})` : `(${c.precision})`;
  } else if (c.scale !== undefined && c.scale !== null) {
    typeStr += `(${c.scale})`;
  }
  const parts = [`    [${c.name}] ${typeStr}`];
  if (c.identity) parts.push('IDENTITY(1,1)');
  parts.push(c.nullable && !c.primaryKey && !c.identity ? 'NULL' : 'NOT NULL');
  if (c.primaryKey) parts.push('PRIMARY KEY');
  if (c.unique && !c.primaryKey) parts.push('UNIQUE');
  if (c.default) parts.push(`DEFAULT ${c.default}`);
  if (c.check) parts.push(`CHECK (${c.check})`);
  if (c.references) {
    const sch = c.references.schema || 'dbo';
    parts.push(`REFERENCES [${sch}].[${c.references.table}]([${c.references.column}])`);
  }
  return parts.join(' ');
}

export const simBackend = {
  async connectionStatus(): Promise<ConnectionStatus> {
    await delay(60);
    return structuredClone(simConn);
  },

  async testConnection(s: ConnectionSettings): Promise<{
    serverReachable: boolean;
    databaseExists: boolean;
    error: string | null;
  }> {
    await delay(180);
    const engine = s.dbType ?? simConn.dbType ?? 'sqlserver';
    if (s.connectionString !== undefined && !s.connectionString.trim()) {
      return { serverReachable: false, databaseExists: false, error: 'Connection string is empty.' };
    }
    if (s.connectionString === undefined && engine === 'sqlite' && !s.database?.trim()) {
      return { serverReachable: false, databaseExists: false, error: 'Database file path is required for SQLite.' };
    }
    if (s.connectionString === undefined && engine !== 'sqlite' && !s.server?.trim()) {
      return { serverReachable: false, databaseExists: false, error: 'Server / host is required.' };
    }
    const dbName =
      s.database?.trim() ||
      (/(?:Database|Data Source)=([^;]+)/i.exec(s.connectionString ?? '')?.[1] ?? 'JsonProcedure');
    return {
      serverReachable: true,
      databaseExists: dbName.toLowerCase() === 'jsonprocedure' || simConn.database === dbName,
      error: null,
    };
  },

  async applyConnection(s: ConnectionSettings): Promise<ConnectionStatus> {
    await delay(200);
    const engine = s.dbType ?? simConn.dbType ?? 'sqlserver';
    if (s.connectionString !== undefined) {
      const serverMatch =
        /(?:Server|Host|Data Source)=([^;]+)/i.exec(s.connectionString)?.[1] ??
        (engine === 'sqlite' ? 'Local file' : 'localhost');
      const dbMatch =
        /(?:Database|Data Source)=([^;]+)/i.exec(s.connectionString)?.[1] ?? 'JsonProcedure';
      const userMatch = /(?:User Id|User|Username|UID)=([^;]+)/i.exec(s.connectionString)?.[1] ?? null;
      simConn = {
        connected: true,
        error: null,
        dbType: engine,
        server: engine === 'sqlite' ? 'Local file' : serverMatch,
        database: dbMatch,
        authType: userMatch || engine !== 'sqlserver' ? 'sql' : 'windows',
        user: userMatch,
        hasPassword: /Password|Pwd=/i.test(s.connectionString),
        trustServerCertificate: /TrustServerCertificate=True/i.test(s.connectionString),
        encrypt: /Encrypt=True/i.test(s.connectionString),
        connectionString: s.connectionString,
      };
    } else if (engine === 'sqlite') {
      const dbPath = s.database?.trim() || './data/json_procedure.db';
      simConn = {
        connected: true,
        error: null,
        dbType: 'sqlite',
        server: 'Local file',
        database: dbPath,
        authType: 'sql',
        user: null,
        hasPassword: false,
        trustServerCertificate: false,
        encrypt: false,
        connectionString: `Data Source=${dbPath};`,
      };
    } else {
      const serverLabel = s.port ? `${s.server || 'localhost'},${s.port}` : s.server || 'localhost';
      const auth = engine === 'sqlserver' ? s.authType ?? 'windows' : 'sql';
      const defaultUser =
        engine === 'postgres'
          ? 'postgres'
          : engine === 'mysql' || engine === 'mariadb'
          ? 'root'
          : engine === 'oracle'
          ? 'system'
          : 'sa';
      simConn = {
        connected: true,
        error: null,
        dbType: engine,
        server: serverLabel,
        database: s.database || 'JsonProcedure',
        authType: auth,
        user: auth === 'sql' ? s.user || defaultUser : null,
        hasPassword: Boolean(s.password),
        trustServerCertificate: Boolean(s.trustServerCertificate),
        encrypt: Boolean(s.encrypt),
        connectionString: `Server=${serverLabel};Database=${s.database || 'JsonProcedure'};`,
      };
    }
    return structuredClone(simConn);
  },

  async listTables(): Promise<TableInfo[]> {
    await delay(90);
    return simTables.map((t) => ({
      schema: t.schema,
      name: t.name,
      rowCount: t.rows.length,
      columns: structuredClone(t.columns),
    }));
  },

  async previewTable(t: { schema?: string; name: string; columns: ColumnDef[] }): Promise<{ sql: string }> {
    await delay(40);
    if (!t.name.trim()) throw new Error('Table name is required.');
    const invalidCol = t.columns.find((c) => !c.name.trim());
    if (invalidCol) throw new Error('All columns must have a name.');
    const schema = t.schema?.trim() || 'dbo';
    const body = t.columns.map(formatColSql).join(',\n');
    return {
      sql: `CREATE TABLE [${schema}].[${t.name.trim()}] (\n${body}\n);`,
    };
  },

  async createTable(t: { schema?: string; name: string; columns: ColumnDef[] }): Promise<{ sql: string }> {
    await delay(160);
    const schema = t.schema?.trim() || 'dbo';
    const name = t.name.trim();
    if (!name) throw new Error('Table name is required.');
    if (simTables.some((x) => x.schema.toLowerCase() === schema.toLowerCase() && x.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`There is already an object named '${name}' in the database.`);
    }
    const { sql } = await simBackend.previewTable(t);
    simTables.push({
      schema,
      name,
      columns: t.columns.map((c) => {
        let typeStr = c.type;
        if (c.length) typeStr += `(${c.length})`;
        else if (c.precision) typeStr += `(${c.precision},${c.scale ?? 0})`;
        return {
          name: c.name.trim(),
          type: typeStr,
          nullable: c.nullable && !c.primaryKey && !c.identity,
          primaryKey: c.primaryKey,
          identity: c.identity,
          unique: c.unique,
          computed: false,
          default: c.default ?? null,
          references: c.references
            ? `${c.references.schema || 'dbo'}.${c.references.table}(${c.references.column})`
            : null,
        };
      }),
      rows: [],
    });
    return { sql };
  },

  async inferColumns(rows: Record<string, unknown>[]): Promise<ColumnDef[]> {
    await delay(100);
    if (!rows.length) throw new Error('JSON array is empty.');
    const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return keys.map((k, idx) => {
      const sample = rows.map((r) => r[k]).find((v) => v !== null && v !== undefined);
      let type = 'nvarchar';
      let length: string | null = '255';
      let precision: number | null = null;
      let scale: number | null = null;
      if (typeof sample === 'boolean') {
        type = 'bit';
        length = null;
      } else if (typeof sample === 'number') {
        if (Number.isInteger(sample)) {
          type = 'int';
          length = null;
        } else {
          type = 'decimal';
          length = null;
          precision = 18;
          scale = 2;
        }
      }
      const isId = idx === 0 && k.toLowerCase() === 'id' && type === 'int';
      return {
        name: k,
        type,
        length,
        precision,
        scale,
        nullable: !isId && rows.some((r) => r[k] === null || r[k] === undefined),
        primaryKey: isId,
        identity: isId,
        unique: isId,
      };
    });
  },

  async dropTable(schema: string, name: string): Promise<void> {
    await delay(120);
    simTables = simTables.filter(
      (t) => !(t.schema.toLowerCase() === schema.toLowerCase() && t.name.toLowerCase() === name.toLowerCase())
    );
  },

  async getRows(schema: string, name: string, top = 100): Promise<ResultSet> {
    await delay(80);
    const table = simTables.find(
      (t) => t.schema.toLowerCase() === schema.toLowerCase() && t.name.toLowerCase() === name.toLowerCase()
    );
    if (!table) throw new Error(`Invalid object name '${schema}.${name}'.`);
    return {
      columns: table.columns.map((c) => c.name),
      rows: structuredClone(table.rows.slice(0, top)),
      json: null,
    };
  },

  async insertRow(schema: string, name: string, values: Record<string, unknown>): Promise<{ inserted: number }> {
    await delay(110);
    const table = simTables.find(
      (t) => t.schema.toLowerCase() === schema.toLowerCase() && t.name.toLowerCase() === name.toLowerCase()
    );
    if (!table) throw new Error(`Invalid object name '${schema}.${name}'.`);
    const row: Record<string, unknown> = {};
    for (const c of table.columns) {
      if (c.identity) {
        const maxId = table.rows.reduce((max, r) => Math.max(max, Number(r[c.name]) || 0), 0);
        row[c.name] = maxId + 1;
      } else if (values[c.name] !== undefined) {
        row[c.name] = values[c.name];
      } else {
        row[c.name] = c.default ? c.default.replace(/^'|'$/g, '') : null;
      }
    }
    table.rows.push(row);
    return { inserted: 1 };
  },

  async importRows(schema: string, name: string, rows: Record<string, unknown>[]): Promise<{ inserted: number }> {
    await delay(160);
    const table = simTables.find(
      (t) => t.schema.toLowerCase() === schema.toLowerCase() && t.name.toLowerCase() === name.toLowerCase()
    );
    if (!table) throw new Error(`Invalid object name '${schema}.${name}'.`);
    for (const input of rows) {
      const row: Record<string, unknown> = {};
      for (const c of table.columns) {
        if (input[c.name] !== undefined) {
          row[c.name] = input[c.name];
        } else if (c.identity) {
          const maxId = table.rows.reduce((max, r) => Math.max(max, Number(r[c.name]) || 0), 0);
          row[c.name] = maxId + 1;
        } else {
          row[c.name] = null;
        }
      }
      table.rows.push(row);
    }
    return { inserted: rows.length };
  },

  async listProcedures(): Promise<ProcedureSummary[]> {
    await delay(80);
    return simProcedures.map((p) => ({
      schema: p.schema,
      name: p.name,
      created: p.created,
      modified: p.modified,
      parameterCount: p.parameters.length,
    }));
  },

  async getProcedure(schema: string, name: string): Promise<ProcedureDetail> {
    await delay(70);
    const proc = simProcedures.find(
      (p) => p.schema.toLowerCase() === schema.toLowerCase() && p.name.toLowerCase() === name.toLowerCase()
    );
    if (!proc) throw new Error(`Procedure '${schema}.${name}' not found.`);
    return {
      schema: proc.schema,
      name: proc.name,
      definition: proc.definition,
      isEncrypted: proc.isEncrypted,
      parameters: structuredClone(proc.parameters),
    };
  },

  async saveProcedure(script: string): Promise<{ saved: boolean }> {
    await delay(150);
    const m = /PROC(?:EDURE)?\s+(?:\[?(\w+)\]?\s*\.\s*)?\[?(\w+)\]?/i.exec(script);
    if (!m) {
      throw new Error('Could not find CREATE PROCEDURE [schema].[name] in script.');
    }
    const schema = m[1] ?? 'dbo';
    const name = m[2];
    const headerPart = script.split(/\bAS\b/i)[0] ?? '';
    const paramMatches = [...headerPart.matchAll(/(@\w+)\s+([a-zA-Z0-9_]+(?:\([^)]*\))?)(?:\s*=\s*([^,\n]+))?(?:\s+(OUT(?:PUT)?))?/gi)];
    const parameters = paramMatches.map((pm) => ({
      name: pm[1],
      type: pm[2],
      hasDefault: Boolean(pm[3]),
      isOutput: Boolean(pm[4]) || /\bOUT(?:PUT)?\b/i.test(pm[0]),
    }));

    const now = new Date().toISOString();
    const existing = simProcedures.find(
      (p) => p.schema.toLowerCase() === schema.toLowerCase() && p.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      existing.definition = script;
      existing.modified = now;
      existing.parameters = parameters;
    } else {
      simProcedures.push({
        schema,
        name,
        created: now,
        modified: now,
        definition: script,
        isEncrypted: false,
        parameters,
      });
    }
    return { saved: true };
  },

  async dropProcedure(schema: string, name: string): Promise<void> {
    await delay(100);
    simProcedures = simProcedures.filter(
      (p) => !(p.schema.toLowerCase() === schema.toLowerCase() && p.name.toLowerCase() === name.toLowerCase())
    );
  },

  async executeProcedure(
    schema: string,
    name: string,
    parameters: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const started = performance.now();
    await delay(160);
    const proc = simProcedures.find(
      (p) => p.schema.toLowerCase() === schema.toLowerCase() && p.name.toLowerCase() === name.toLowerCase()
    );
    if (!proc) throw new Error(`Could not find stored procedure '${schema}.${name}'.`);

    // Try to resolve FROM <table> in definition
    const fromMatch = /FROM\s+(?:\[?(\w+)\]?\s*\.\s*)?\[?(\w+)\]?/i.exec(proc.definition);
    let rows: Record<string, unknown>[] = [];
    let columns: string[] = [];

    if (fromMatch) {
      const tSchema = fromMatch[1] ?? 'dbo';
      const tName = fromMatch[2];
      const table = simTables.find(
        (t) => t.schema.toLowerCase() === tSchema.toLowerCase() && t.name.toLowerCase() === tName.toLowerCase()
      );
      if (table) {
        rows = structuredClone(table.rows);
        // Apply simple parameter matching if user passed @PlanTier or @CustomerId
        for (const [k, v] of Object.entries(parameters)) {
          if (v === null || v === undefined) continue;
          const colName = k.replace(/^@/, '');
          const matchingCol = table.columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
          if (matchingCol) {
            rows = rows.filter((r) => String(r[matchingCol.name]).toLowerCase() === String(v).toLowerCase());
          }
        }
        columns = table.columns.map((c) => c.name);
      }
    }

    if (columns.length === 0) {
      columns = ['Id', 'Message'];
      rows = [{ Id: parameters['@Id'] ?? 1, Message: 'hello' }];
    }

    const outputParameters: Record<string, unknown> = {};
    for (const p of proc.parameters) {
      if (p.isOutput) {
        outputParameters[p.name] = rows.length;
      }
    }

    return {
      resultSets: [{ columns, rows, json: null }],
      outputParameters,
      returnValue: 0,
      rowsAffected: rows.length,
      elapsedMs: Math.max(1, Math.round(performance.now() - started)),
    };
  },
};
