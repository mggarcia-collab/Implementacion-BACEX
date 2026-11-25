import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Crear CheckList Sugerido",
  icon: "✅",
  desc: "Crear un nuevo CheckList sugerido",
  kind: "primary",
};

export default function CrearCheckListSugerido() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
