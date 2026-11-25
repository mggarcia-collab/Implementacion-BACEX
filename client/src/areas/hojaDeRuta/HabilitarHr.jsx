import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Habilitar HR",
  icon: "📄",
  desc: "Habilitar Hoja de Ruta",
  kind: "primary",
};

export default function HabilitarHr() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
