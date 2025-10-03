// src/lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

// These must be defined (with the VITE_ prefix) in your environment.
// - Locally:   put them in a .env file at the project root
// - On Vercel: add them in Project → Settings → Environment Variables
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // This helps you spot a misconfigured environment in the browser console.
  // The app will still load but auth-dependent features won’t work.
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
    "Add them to .env (local) and Vercel env vars (prod)."
  );
}

export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: true,          // keep user logged in across refreshes
    autoRefreshToken: true,        // refresh tokens in the background
    detectSessionInUrl: true,      // supports magic link flows
  },
});
