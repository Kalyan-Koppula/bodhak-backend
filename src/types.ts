// src/types.ts

// 💥 DELETE THE ORIGINAL 'export interface Env { ... }' BLOCK 💥

// Define a separate interface for your custom bindings and let TypeScript
// automatically merge it into the global 'Env' type.
// This is the idiomatic way to extend the worker's environment object.
interface CloudflareBindings {
  bodhak: D1Database;

  // Secrets (injected via .dev.vars or wrangler secret put)
  JWT_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO_OWNER: string;
  GITHUB_REPO_NAME: string;
  GITHUB_REPO_BRANCH?: string;
  ADMIN_PASSWORD: string;

  // Variables (injected via wrangler.jsonc vars)
  ADMIN_USERNAME: string;
}

// Global declaration to merge our bindings into the global Env interface
declare global {
  interface Env extends CloudflareBindings {}
}

export interface Subject {
  id: number;
  title: string;
  rank: string;
}

export interface Topic {
  id: number;
  subject_id: number;
  title: string;
  rank: string;
}

export interface Article {
  id: number;
  topic_id: number;
  title: string;
  file_path: string;
  rank: string;
}
