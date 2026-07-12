"use server";

import { timingSafeEqual } from "node:crypto";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { getBootstrapSetupToken } from "@/lib/supabase/env";

function compareToken(input: string, expected: string) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, expectedBuffer);
}

function getString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function redirectWithStatus(status: string) {
  redirect(`/setup?status=${encodeURIComponent(status)}`);
}

async function findUserByEmail(email: string) {
  const admin = createAdminClient();

  for (let page = 1; page <= 20; page += 1) {
    const {
      data: { users },
      error,
    } = await admin.auth.admin.listUsers({ page, perPage: 100 });

    if (error) {
      throw error;
    }

    const found = users.find((user) => user.email?.toLowerCase() === email);

    if (found || users.length < 100) {
      return found ?? null;
    }
  }

  return null;
}

async function getOrCreateUser(email: string, password: string, displayName: string) {
  const admin = createAdminClient();
  const existingUser = await findUserByEmail(email);

  if (existingUser) {
    return existingUser;
  }

  const {
    data: { user },
    error,
  } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      display_name: displayName,
    },
  });

  if (error || !user) {
    throw error ?? new Error("Supabase did not return a created user.");
  }

  return user;
}

async function getOrCreateClub(name: string, shortName: string, user: User) {
  const admin = createAdminClient();
  const { data: existingClub, error: existingError } = await admin
    .from("clubs")
    .select("id")
    .eq("short_name", shortName)
    .is("archived_at", null)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingClub) {
    return existingClub;
  }

  const { data: club, error } = await admin
    .from("clubs")
    .insert({
      name,
      short_name: shortName,
      status: "active",
    })
    .select("id")
    .single();

  if (error || !club) {
    throw error ?? new Error("Supabase did not return a created club.");
  }

  await admin.from("audit_logs").insert({
    action: "club.bootstrap_created",
    actor_user_id: user.id,
    after_data: { name, short_name: shortName },
    club_id: club.id,
    entity_id: club.id,
    entity_type: "clubs",
    metadata: { source: "setup" },
  });

  return club;
}

async function hasExistingClubAdmin() {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("user_roles")
    .select("id", { count: "exact", head: true })
    .eq("role_key", "club_admin");

  if (error) {
    throw error;
  }

  return Boolean(count && count > 0);
}

export async function bootstrapClubAdmin(formData: FormData) {
  const token = getString(formData, "setupToken");
  const expectedToken = getBootstrapSetupToken();
  const allowRepeat = process.env.BOOTSTRAP_ALLOW_REPEAT === "true";

  if (!compareToken(token, expectedToken)) {
    redirectWithStatus("invalid-token");
  }

  if (!allowRepeat && (await hasExistingClubAdmin())) {
    redirectWithStatus("already-bootstrapped");
  }

  const email = getString(formData, "email").toLowerCase();
  const password = getString(formData, "password");
  const displayName = getString(formData, "displayName") || email;
  const clubName = getString(formData, "clubName") || "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค";
  const shortName = (getString(formData, "shortName") || "PEAGC").toUpperCase();

  if (!email.includes("@")) {
    redirectWithStatus("invalid-email");
  }

  if (password.length < 8) {
    redirectWithStatus("weak-password");
  }

  try {
    const admin = createAdminClient();
    const user = await getOrCreateUser(email, password, displayName);
    const club = await getOrCreateClub(clubName, shortName, user);

    const { error: profileError } = await admin.from("profiles").upsert({
      display_name: displayName,
      id: user.id,
      updated_at: new Date().toISOString(),
    });

    if (profileError) {
      throw profileError;
    }

    const { error: roleError } = await admin.from("user_roles").upsert(
      {
        club_id: club.id,
        created_by: user.id,
        role_key: "club_admin",
        user_id: user.id,
      },
      { onConflict: "club_id,user_id,role_key" },
    );

    if (roleError) {
      throw roleError;
    }

    const { error: memberTypeError } = await admin.from("member_types").upsert(
      [
        { club_id: club.id, name: "สมาชิก", status: "active" },
        { club_id: club.id, name: "แขก", status: "active" },
      ],
      { onConflict: "club_id,name" },
    );

    if (memberTypeError) {
      throw memberTypeError;
    }

    await admin.from("audit_logs").insert({
      action: "user_role.bootstrap_assigned",
      actor_user_id: user.id,
      after_data: { email, role_key: "club_admin" },
      club_id: club.id,
      entity_id: user.id,
      entity_type: "user_roles",
      metadata: { source: "setup" },
    });
  } catch (error) {
    console.error("Bootstrap setup failed", error);
    redirectWithStatus("failed");
  }

  redirectWithStatus("created");
}
