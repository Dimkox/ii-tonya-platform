import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export interface ExternalPostgresDatabase {
  getConnectionUri(): string;
  stop(): Promise<void>;
}

const databaseName = (): string =>
  `ii_tonya_test_${randomUUID().replaceAll("-", "")}`;

const databaseUrl = (adminUrl: string, name: string): string => {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

export async function startExternalPostgresDatabase(
  adminUrl: string,
): Promise<ExternalPostgresDatabase> {
  const name = databaseName();
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  return {
    getConnectionUri: () => databaseUrl(adminUrl, name),
    stop: async () => {
      const cleanup = new Pool({ connectionString: adminUrl, max: 1 });
      try {
        await cleanup.query(`drop database if exists "${name}"`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
