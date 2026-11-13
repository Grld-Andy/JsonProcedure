import React from 'react';
import sqlServerIcon from 'devicon/icons/microsoftsqlserver/microsoftsqlserver-original.svg';
import mysqlIcon from 'devicon/icons/mysql/mysql-original.svg';
import postgresIcon from 'devicon/icons/postgresql/postgresql-original.svg';
import sqliteIcon from 'devicon/icons/sqlite/sqlite-original.svg';

export type DatabaseEngine =
  | 'sqlserver'
  | 'postgres'
  | 'mysql'
  | 'sqlite'
  | 'mariadb'
  | 'oracle';

export interface DatabaseEngineMeta {
  id: DatabaseEngine;
  name: string;
  defaultPort: string;
  supportsWindowsAuth: boolean;
  isFileBased: boolean;
  hostPlaceholder: string;
  userPlaceholder: string;
  dbPlaceholder: string;
  sampleConnectionString: string;
}

export const DATABASE_ENGINES: DatabaseEngineMeta[] = [
  {
    id: 'sqlserver',
    name: 'SQL Server',
    defaultPort: '1433',
    supportsWindowsAuth: true,
    isFileBased: false,
    hostPlaceholder: 'localhost or (localdb)\\MSSQLLocalDB',
    userPlaceholder: 'sa',
    dbPlaceholder: 'JsonProcedure',
    sampleConnectionString:
      'Server=localhost;Database=JsonProcedure;Trusted_Connection=True;TrustServerCertificate=True;',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    defaultPort: '5432',
    supportsWindowsAuth: false,
    isFileBased: false,
    hostPlaceholder: 'localhost or db.example.com',
    userPlaceholder: 'postgres',
    dbPlaceholder: 'json_procedure',
    sampleConnectionString:
      'Host=localhost;Port=5432;Database=json_procedure;Username=postgres;Password=secret;',
  },
  {
    id: 'mysql',
    name: 'MySQL',
    defaultPort: '3306',
    supportsWindowsAuth: false,
    isFileBased: false,
    hostPlaceholder: 'localhost or mysql.example.com',
    userPlaceholder: 'root',
    dbPlaceholder: 'json_procedure',
    sampleConnectionString:
      'Server=localhost;Port=3306;Database=json_procedure;Uid=root;Pwd=secret;',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    defaultPort: '',
    supportsWindowsAuth: false,
    isFileBased: true,
    hostPlaceholder: 'Local file',
    userPlaceholder: '',
    dbPlaceholder: './data/json_procedure.db',
    sampleConnectionString: 'Data Source=./data/json_procedure.db;',
  },
  {
    id: 'mariadb',
    name: 'MariaDB',
    defaultPort: '3306',
    supportsWindowsAuth: false,
    isFileBased: false,
    hostPlaceholder: 'localhost or mariadb.example.com',
    userPlaceholder: 'root',
    dbPlaceholder: 'json_procedure',
    sampleConnectionString:
      'Server=localhost;Port=3306;Database=json_procedure;User=root;Password=secret;',
  },
  {
    id: 'oracle',
    name: 'Oracle',
    defaultPort: '1521',
    supportsWindowsAuth: false,
    isFileBased: false,
    hostPlaceholder: 'localhost/XEPDB1',
    userPlaceholder: 'system',
    dbPlaceholder: 'XEPDB1',
    sampleConnectionString:
      'Data Source=localhost:1521/XEPDB1;User Id=system;Password=secret;',
  },
];

export function getDatabaseEngineMeta(engine?: DatabaseEngine | null): DatabaseEngineMeta {
  return DATABASE_ENGINES.find((e) => e.id === engine) ?? DATABASE_ENGINES[0];
}

export const DatabaseBrandIcon: React.FC<{
  engine?: DatabaseEngine | null;
  className?: string;
}> = ({ engine = 'sqlserver', className = 'h-5 w-5' }) => {
  switch (engine) {
    case 'postgres':
      return (
        <img
          src={postgresIcon}
          alt=""
          aria-hidden="true"
          className={`${className} object-contain`}
        />
      );

    case 'mysql':
      return (
        <img
          src={mysqlIcon}
          alt=""
          aria-hidden="true"
          className={`${className} object-contain dark:brightness-125`}
        />
      );

    case 'sqlite':
      return (
        <img
          src={sqliteIcon}
          alt=""
          aria-hidden="true"
          className={`${className} object-contain`}
        />
      );

    case 'mariadb':
      return (
        <svg viewBox="0 0 128 128" className={className} aria-hidden="true">
          <path
            className="fill-[#003545] dark:fill-sky-300"
            d="M127.403 22.767a1.824 1.824 0 0 0-1.24-.414c-1.236 0-2.833.838-3.693 1.287l-.34.175a11.721 11.721 0 0 1-4.612 1.16 64.756 64.756 0 0 0-4.896.34c-10.91 1.121-15.777 9.484-20.464 17.57-2.552 4.399-5.188 8.969-8.802 12.46-.747.724-1.541 1.4-2.378 2.02-3.74 2.78-8.435 4.765-12.088 6.17-3.518 1.345-7.359 2.553-11.066 3.722-3.4 1.07-6.609 2.082-9.56 3.178-1.144.422-2.299.823-3.459 1.205-2.688.872-4.626 1.54-7.458 3.49a47.949 47.949 0 0 0-2.963 2.183 31.255 31.255 0 0 0-5.913 6.227 36.767 36.767 0 0 1-4.966 5.961c-.598.584-1.659.872-3.248.872-1.86 0-4.115-.384-6.501-.79-2.462-.435-5.006-.85-7.188-.85-1.771 0-3.13.29-4.141.873 0 0-1.708.995-2.427 2.282l.707.32a14.493 14.493 0 0 1 3.02 2.181 15.153 15.153 0 0 0 3.141 2.234c.365.134.695.344.97.616-.296.436-.734.999-1.193 1.6-2.517 3.296-3.987 5.377-3.145 6.511.404.21.855.312 1.31.297 5.49 0 8.44-1.426 12.17-3.233 1.082-.522 2.182-1.06 3.491-1.615 2.182-.946 4.531-2.456 7.022-4.054 3.26-2.124 6.668-4.306 9.976-5.358a27.188 27.188 0 0 1 8.391-1.179c3.492 0 7.167.466 10.71.92 2.641.342 5.377.69 8.06.852a50.27 50.27 0 0 0 2.946.092 34.127 34.127 0 0 0 3.757-.196l.3-.105c1.883-1.158 2.765-3.64 3.618-6.04.551-1.546 1.014-2.933 1.747-3.814.043-.043.09-.082.14-.117a.175.175 0 0 1 .213.034v.07c-.435 9.387-4.215 15.348-8.038 20.646l-2.552 2.736s3.573 0 5.607-.786c7.42-2.217 13.018-7.104 17.093-14.899a63.583 63.583 0 0 0 2.693-6.15c.07-.172.712-.496.65.407-.021.267-.04.563-.061.874 0 .182 0 .37-.035.558-.104 1.31-.414 4.076-.414 4.076l2.29-1.227c5.525-3.49 9.784-10.533 13.015-21.491 1.344-4.566 2.33-9.1 3.197-13.093 1.039-4.801 1.935-8.915 2.96-10.512 1.61-2.506 4.067-4.2 6.445-5.844.323-.222.65-.437.97-.673 2.988-2.098 5.96-4.52 6.616-9.037v-.1c.474-3.37.073-4.228-.384-4.621z"
          />
        </svg>
      );

    case 'oracle':
      return (
        <svg viewBox="0 42 128 44" className={className} aria-hidden="true">
          <path
            fill="#EA1B22"
            d="M55.387 66.469h8.333l-4.407-7.09-8.088 12.819h-3.681L57.382 56.8a2.324 2.324 0 011.931-.998c.765 0 1.478.363 1.892.972l9.876 15.424H67.4l-1.736-2.865h-8.438l-1.839-2.864zm38.235 2.864V55.958h-3.123v14.685c0 .402.156.791.454 1.089.298.298.7.466 1.141.466h14.244l1.841-2.865H93.622zm-51.677-2.397c3.033 0 5.496-2.449 5.496-5.482s-2.462-5.496-5.496-5.496H28.28v16.241h3.123V58.822h10.335c1.452 0 2.618 1.18 2.618 2.631s-1.167 2.631-2.618 2.631l-8.806-.013 9.324 8.127h4.538l-6.274-5.263h1.425zM9.059 72.198c-4.483 0-8.122-3.629-8.122-8.114s3.638-8.127 8.122-8.127h9.439c4.485 0 8.121 3.643 8.121 8.127s-3.636 8.114-8.121 8.114H9.059zm9.229-2.865a5.25 5.25 0 005.258-5.249 5.262 5.262 0 00-5.258-5.263H9.267a5.262 5.262 0 00-5.256 5.263 5.25 5.25 0 005.256 5.249h9.021zm59.314 2.865c-4.484 0-8.126-3.629-8.126-8.114s3.642-8.127 8.126-8.127h11.212l-1.829 2.864H77.81a5.267 5.267 0 00-5.264 5.263c0 2.903 2.36 5.249 5.264 5.249h11.263l-1.84 2.865h-9.631zm38.197-2.865a5.25 5.25 0 01-5.055-3.824h13.35l1.84-2.864h-15.19a5.266 5.266 0 015.055-3.824h9.163l1.854-2.864h-11.225c-4.484 0-8.126 3.643-8.126 8.127s3.642 8.114 8.126 8.114h9.631l1.841-2.865h-11.264"
          />
        </svg>
      );

    case 'sqlserver':
    default:
      return (
        <img
          src={sqlServerIcon}
          alt=""
          aria-hidden="true"
          className={`${className} object-contain`}
        />
      );
  }
};
