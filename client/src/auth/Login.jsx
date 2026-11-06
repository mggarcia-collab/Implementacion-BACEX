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
      <div style={{
        position: "relative", display: "flex", width: "100%", maxWidth: "1100px",
        borderRadius: "28px", overflow: "hidden", boxShadow: "0 30px 80px rgba(15, 23, 42, 0.22)"
      }}>
        {/* Línea curva con brillo, sobre la división de los dos paneles */}
        <svg
          style={{ position: "absolute", left: "50%", top: 0, height: "100%", width: "160px", transform: "translateX(-50%)", zIndex: 2, pointerEvents: "none" }}
          viewBox="0 0 160 1000"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="loginCurveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1f3651" />
              <stop offset="50%" stopColor="#2c4a6e" />
              <stop offset="100%" stopColor="#5b8fb9" />
            </linearGradient>
            <linearGradient id="loginCurveGradCore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a8c6e0" />
              <stop offset="50%" stopColor="#cfe1ee" />
              <stop offset="100%" stopColor="#e6f0f8" />
            </linearGradient>
            <filter id="loginCurveGlow" x="-150%" y="-30%" width="400%" height="160%">
              <feGaussianBlur stdDeviation="12" result="blurWide" />
              <feGaussianBlur stdDeviation="4" result="blurTight" />
              <feMerge>
                <feMergeNode in="blurWide" />
                <feMergeNode in="blurTight" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* Halo ancho detrás para dar sensación de iluminación */}
          <path
            d="M 80 0 C 30 260, 130 500, 70 1000"
            fill="none"
            stroke="url(#loginCurveGrad)"
            strokeWidth="6"
            filter="url(#loginCurveGlow)"
            opacity="0.9"
          />
          {/* Núcleo brillante encima, nítido, simula el resplandor central */}
          <path
            d="M 80 0 C 30 260, 130 500, 70 1000"
            fill="none"
            stroke="url(#loginCurveGradCore)"
            strokeWidth="1.6"
            opacity="0.85"
          />
        </svg>

        {/* Panel de marca: el fondo de la imagen es transparente de verdad, así que el
            degradado de Vesta se ve detrás sin alterar los colores originales del logo */}
        <div className="login-split-brand" style={{
          flex: "0 0 50%",
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(150deg, #1f3651 0%, #2c4a6e 50%, #5b8fb9 100%)"
        }}>
          <div style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/logo-login.png), radial-gradient(circle at center, rgba(148,163,184,0) 0%, rgba(148,163,184,0) 52%, rgba(148,163,184,0.4) 68%, rgba(148,163,184,0) 88%)",
            backgroundSize: "65%, 100%",
            backgroundRepeat: "no-repeat, no-repeat",
            backgroundPosition: "center, center"
          }} />
        </div>

        {/* Panel del formulario, con tinte rosado a juego con la marca */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px",
          background: "linear-gradient(160deg, #eaf2f8 0%, #dce8f2 100%)"
        }}>
          <div style={{
            width: "100%", maxWidth: "380px",
            background: "#fff", borderRadius: "22px",
            boxShadow: "0 20px 45px rgba(15, 23, 42, 0.1)",
            padding: "40px 36px"
          }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "18px" }}>
            <div style={{
              width: "92px", height: "92px", borderRadius: "50%",
              background: "linear-gradient(135deg, #1f3651, #2c4a6e)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          </div>

          <h2 style={{
            textAlign: "center", fontSize: "27px", fontWeight: 300, color: "#0f172a", marginBottom: "4px",
            letterSpacing: "0.04em"
          }}>
            Iniciar Sesión
          </h2>
          <p style={{ textAlign: "center", color: "#697386", fontSize: "14px", marginBottom: "28px" }}>
            Mantenimientos
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
          </div>
        </div>
      </div>
    </div>
  );
}
