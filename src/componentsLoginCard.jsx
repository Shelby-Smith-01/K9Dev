import React, { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function LoginCard() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onLogin(e){
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) setErr(error.message);
    setBusy(false);
  }

  async function onLogout(){ await supabase.auth.signOut(); }

  return (
    <div style={{ padding: 12, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Operator Sign-in</div>
      <form onSubmit={onLogin} style={{ display: "grid", gap: 8 }}>
        <input placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} style={{padding:8, border:'1px solid #e5e7eb', borderRadius:8}}/>
        <input placeholder="password" type="password" value={pass} onChange={e=>setPass(e.target.value)} style={{padding:8, border:'1px solid #e5e7eb', borderRadius:8}}/>
        <button disabled={busy} style={{padding:'8px 12px', borderRadius:8, background:'#111', color:'#fff', border:'none'}}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {err && <div style={{ color: "#b91c1c", fontSize: 12 }}>{err}</div>}
      </form>
      <button onClick={onLogout} style={{ marginTop: 8 }}>Sign out</button>
    </div>
  );
}
