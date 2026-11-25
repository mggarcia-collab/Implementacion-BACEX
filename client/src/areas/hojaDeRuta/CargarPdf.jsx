import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Cargar PDF",
  icon: "📎",
  desc: "Módulo para cargar PDF",
  kind: "primary",
};

export default function CargarPdf() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
