import { useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import PasswordField from "../components/PasswordField.jsx";

function UserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [nombreUsuario, setNombreUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!nombreUsuario.trim() || !password) {
      setError("Ingrese usuario y contraseña");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(nombreUsuario.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #dce8f2 0%, #eef4f9 100%)", padding: "32px"
    }}>
      <div className="login-card" style={{
        width: "100%", maxWidth: "420px", position: "relative", overflow: "hidden",
        background: "#fff", borderRadius: "28px",
        boxShadow: "0 30px 80px rgba(15, 23, 42, 0.18)",
        padding: "44px 40px"
      }}>
        {/* Marca de agua del logo de Vesta, para que el formulario se vea con la identidad
            de la empresa y no como un login genérico */}
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: -1, opacity: 0.05, pointerEvents: "none", userSelect: "none",
          width: "340px", height: "340px", display: "flex", justifyContent: "center", alignItems: "center"
        }}>
          <img src="/vesta-logo.png" alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>

        {/* Logo de Vesta -- reemplaza al ícono genérico de usuario que había antes. */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "22px" }}>
          <img src="/vesta-logo.png" alt="Vesta" style={{ width: "96px", height: "96px", objectFit: "contain" }} />
        </div>

        <h2 style={{
          textAlign: "center", fontSize: "27px", fontWeight: 300, color: "#0f172a", marginBottom: "4px",
          letterSpacing: "0.04em"
        }}>
          Iniciar Sesión
        </h2>
        <p style={{ textAlign: "center", color: "#697386", fontSize: "14px", marginBottom: "28px" }}>
          Ingresa tus credenciales para continuar
        </p>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label>Usuario</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8", display: "flex" }}>
                <UserIcon />
              </span>
              <input
                type="text"
                placeholder="Ingresa tu usuario"
                value={nombreUsuario}
                onChange={(e) => setNombreUsuario(e.target.value)}
                disabled={loading}
                autoFocus
                style={{ paddingLeft: "42px" }}
              />
            </div>
          </div>
          <div className="field">
            <label>Contraseña</label>
            <PasswordField
              withIcon
              placeholder="Ingresa tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <button
            className="btn primary"
            type="submit"
            disabled={loading}
            style={{
              width: "100%", marginTop: "8px", textTransform: "uppercase", letterSpacing: "0.04em",
              background: "linear-gradient(135deg, #1f3651, #2c4a6e)", border: "none"
            }}
          >
            {loading ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>

        <div style={{
          textAlign: "center", marginTop: "26px",
          fontSize: "11px", fontWeight: 700, color: "#2c4a6e", letterSpacing: "0.18em"
        }}>
          IMS <span style={{ color: "#94a3b8", fontWeight: 500 }}>· Incident Management System</span>
        </div>
      </div>
    </div>
  );
}
