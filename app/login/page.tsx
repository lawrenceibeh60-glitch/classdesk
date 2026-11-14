import LoginForm from "@/components/login-form";

export default function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="panel" style={{ width: "min(100%, 420px)" }}>
        <div className="brand" style={{ padding: 0, marginBottom: 28 }}>
          <div className="brand-mark">CD</div>
          <div><strong>AFIT CLASSDESK</strong><small>PRIVATE CLASS WORKSPACE</small></div>
        </div>
        <div className="eyebrow">Authorised account access</div>
        <h1 style={{ fontSize: 27 }}>Welcome back.</h1>
        <p className="sub">Sign in with your assigned Class Representative or Assistant Class Representative account.</p>
        <LoginForm />
        <p className="sub" style={{ marginTop: 18, fontSize: 11 }}>Access is limited to the two authorised ClassDesk accounts. Registration is disabled.</p>
      </div>
    </main>
  );
}
