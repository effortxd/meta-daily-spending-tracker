// lib/storage.js
// Drop-in replacement for window.storage using Supabase.
// Mirrors the .get / .set / .delete / .list interface from the Claude artifact env.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
  );
}

const supabase = createClient(supabaseUrl || "", supabaseAnonKey || "");

export const storage = {
  async get(key /*, shared */) {
    const { data, error } = await supabase
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: data.value };
  },

  async set(key, value /*, shared */) {
    const { error } = await supabase
      .from("kv_store")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    return { key, value };
  },

  async delete(key /*, shared */) {
    const { error } = await supabase.from("kv_store").delete().eq("key", key);
    if (error) throw error;
    return { key, deleted: true };
  },

  async list(prefix /*, shared */) {
    let query = supabase.from("kv_store").select("key");
    if (prefix) query = query.like("key", `${prefix}%`);
    const { data, error } = await query;
    if (error) throw error;
    return { keys: (data || []).map((d) => d.key), prefix };
  },
};
