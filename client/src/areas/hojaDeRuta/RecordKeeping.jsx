import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Record Keeping",
  icon: "🗃️",
  desc: "Record Keeping de la Hoja de Ruta",
  kind: "primary",
};

export default function RecordKeeping() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
