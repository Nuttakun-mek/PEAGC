const publicUrlKey = "NEXT_PUBLIC_SUPABASE_URL";
const publicPublishableKey = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
const secretKey = "SUPABASE_SECRET_KEY";

export type SupabasePublicConfig = {
  url: string;
  publishableKey: string;
};

export function hasSupabasePublicConfig() {
  return Boolean(
    process.env[publicUrlKey] && process.env[publicPublishableKey],
  );
}

export function getSupabasePublicConfig(): SupabasePublicConfig {
  const url = process.env[publicUrlKey];
  const publishableKey = process.env[publicPublishableKey];

  if (!url || !publishableKey) {
    throw new Error(
      `Missing Supabase public env. Set ${publicUrlKey} and ${publicPublishableKey}.`,
    );
  }

  return { url, publishableKey };
}

export function getSupabaseSecretKey() {
  const value = process.env[secretKey];

  if (!value) {
    throw new Error(`Missing Supabase server env. Set ${secretKey}.`);
  }

  return value;
}
