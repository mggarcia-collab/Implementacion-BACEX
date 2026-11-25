import PlaceholderModulo from "./PlaceholderModulo.jsx";

export const meta = {
  label: "Facturación",
  icon: "🧾",
  desc: "Facturación (Uno Honduras)",
  kind: "primary",
};

export default function Facturacion() {
  return <PlaceholderModulo titulo={meta.label} descripcion={meta.desc} />;
}
