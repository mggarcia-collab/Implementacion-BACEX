import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Criterio Analista Certificado",
  icon: "🎓",
  desc: "Criterio de Analista Certificado",
  kind: "primary",
};

export default function CriterioAnalistaCertificado() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
