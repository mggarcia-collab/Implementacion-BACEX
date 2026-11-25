import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Crear Criterio UAD",
  icon: "📐",
  desc: "Crear un nuevo criterio UAD",
  kind: "primary",
};

export default function CrearCriterioUad() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
