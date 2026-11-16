const URL_INCIDENTES = "https://link.vesta-accelerate.com/incidentes-sistemas/0f86d54a-15e7-48b4-af10-1081e32cc009/Interno/a4b6ba0d-2ae0-48b1-b33e-26a58b5384d6";

export const meta = {
  label: "Incidentes",
  icon: "🎫",
  desc: "Tickets de Incidentes de Sistemas",
};

export default function Incidentes() {
  return (
    <div style={{ position: "relative", height: "calc(100vh - 170px)" }}>
      <a
        href={URL_INCIDENTES}
        target="_blank"
        rel="noopener noreferrer"
        title="Abrir en una pestaña aparte"
        style={{
          position: "absolute", top: "10px", right: "10px", zIndex: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: "26px", height: "26px", borderRadius: "6px",
          background: "rgba(255,255,255,0.9)", color: "#697386", textDecoration: "none",
          border: "1px solid #e3e8ee", fontSize: "13px"
        }}
      >
        ↗
      </a>
      <iframe
        src={URL_INCIDENTES}
        title={meta.label}
        style={{ width: "100%", height: "100%", border: "none", background: "white" }}
      />
    </div>
  );
}
